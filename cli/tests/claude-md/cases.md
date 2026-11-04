# plain
@a.md
Read @b.md first, then @c.md#section and @my\ notes.md.
=====
# fenced
```
@a.md
```
~~~md
@b.md
~~~
````
```
@c.md
````
@d.md
=====
# indented-code
Example:

    @a.md

@b.md
=====
# inline-code
Run `cat @a.md` and ``cat @b.md ` x`` then @c.md.
=====
# comments
<!-- @a.md -->
<!-- note --> @b.md
Text <!-- @c.md --> @d.md
<!--
@e.md
-->
@f.md
=====
# html-block
<details>
@a.md
</details>

@b.md
=====
# emphasis
Read **@a.md** and *@b.md* and ~~@c.md~~ and [@d.md](x) and <b>@e.md</b>.
=====
# punctuation
x|@a.md (@b.md) "@c.md" >@d.md
=====
# blockquote
> @a.md
> see `@b.md`
=====
# list
- @a.md
- Run `cat @b.md`
- see <!-- x --> @c.md
- **@d.md**

  Loose `@e.md`
1. @f.md
=====
# nested-list
- top
  - Run `cat @a.md`
=====
# table
| col | col |
| --- | --- |
| @a.md | `@b.md` |
=====
# heading
## See @a.md and `@b.md`
=====
# escape
@my\_file.md and @x\*y.md
=====
# email-and-at
mail me@host.md and @@a.md and @/ and @/abs.md and @~/home.md and @./rel.md
=====
---
paths: "*.md"
---
# frontmatter
@a.md
=====
---
title: @fm.md
---
# frontmatter-import
@b.md
=====
# image
![@a.md](x.png) @b.md
=====
# link-ref
[ref]: @a.md
@b.md
=====
# setext
@a.md
---
=====
# hard-break
line one\
@a.md and two  
@b.md
