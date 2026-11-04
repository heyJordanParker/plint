import { extname } from 'node:path'

export type Diagnostic = {
  readonly range: { readonly start: { readonly line: number } }
  readonly severity?: number
  readonly code?: string | number
  readonly message: string
}

export type Server = {
  request(method: string, params: unknown): Promise<unknown>
  asked(method: string): Promise<void>
}

type Message = { readonly id?: number | string; readonly method?: string; readonly params?: unknown; readonly result?: unknown; readonly error?: { readonly message: string } }

const LANGUAGES: Readonly<Record<string, string>> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascriptreact',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescriptreact',
  '.css': 'css', '.json': 'json', '.jsonc': 'jsonc',
}

export async function openedDiagnostics(command: readonly string[], env: Readonly<Record<string, string>>, folder: string, file: string, text: string, timeout: number, isIgnored?: (server: Server) => Promise<boolean>): Promise<readonly Diagnostic[]> {
  const started = performance.now()
  const child = Bun.spawn([...command], { cwd: folder, env: { ...process.env, ...env }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', timeout })
  let stderr = ''
  void (async () => {
    for await (const chunk of child.stderr) stderr += Buffer.from(chunk).toString()
  })()
  const uri = Bun.pathToFileURL(file).href
  const answers = new Map<number, PromiseWithResolvers<unknown>>()
  const asks = new Map<string, PromiseWithResolvers<void>>()
  const ask = (method: string): PromiseWithResolvers<void> => asks.get(method) ?? asks.set(method, Promise.withResolvers<void>()).get(method) as PromiseWithResolvers<void>
  const published = Promise.withResolvers<readonly Diagnostic[]>()
  let lastId = 0

  const send = (message: object): void => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    void child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    void child.stdin.flush()
  }
  const server: Server = {
    request: (method, params) => {
      lastId += 1
      const answer = Promise.withResolvers<unknown>()
      answers.set(lastId, answer)
      send({ id: lastId, method, params })
      return answer.promise
    },
    asked: (method) => ask(method).promise,
  }
  const receive = (message: Message): void => {
    if (message.method !== undefined && message.id !== undefined) {
      const items = (message.params as { items?: readonly unknown[] } | undefined)?.items ?? []
      send({ id: message.id, result: message.method === 'workspace/configuration' ? items.map(() => null) : null })
      ask(message.method).resolve()
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { uri: string; diagnostics: readonly Diagnostic[] }
      if (params.uri === uri) published.resolve(params.diagnostics)
    } else if (typeof message.id === 'number') {
      const answer = answers.get(message.id)
      if (message.error === undefined) answer?.resolve(message.result)
      else answer?.reject(new Error(message.error.message))
    }
  }
  const ended = Promise.withResolvers<never>()
  ended.promise.catch(() => undefined)
  read(child.stdout, receive).catch(ended.reject)
  void child.exited.then((code) => ended.reject(new Error(child.signalCode === null ? `it exited ${code}: ${oneLine(stderr)}` : performance.now() - started >= timeout ? `it ran past ${seconds(timeout)}` : `it stopped on ${child.signalCode}`)))
  const beforeEnd = <T>(work: Promise<T>): Promise<T> => Promise.race([work, ended.promise])

  try {
    const root = Bun.pathToFileURL(folder).href
    await beforeEnd(server.request('initialize', { processId: process.pid, rootUri: root, workspaceFolders: [{ uri: root, name: 'rulebook' }], capabilities: {} }))
    send({ method: 'initialized', params: {} })
    if (isIgnored !== undefined && (await beforeEnd(isIgnored(server)))) return []
    send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: LANGUAGES[extname(file)] ?? 'plaintext', version: 1, text } } })
    return await beforeEnd(published.promise)
  } finally {
    child.kill()
  }
}

async function read(stream: ReadableStream<Uint8Array>, receive: (message: Message) => void): Promise<void> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const header = buffer.indexOf('\r\n\r\n')
      if (header === -1) break
      const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, header).toString())?.[1])
      if (buffer.length < header + 4 + length) break
      receive(JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString()) as Message)
      buffer = buffer.subarray(header + 4 + length)
    }
  }
}

export function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${ms / 1000} s`
}

export function oneLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '').join(' ')
}
