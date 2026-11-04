top-tag
Some text
<example>
@q1.md
</example>
=====
item-first-tag
- <example>
  @q2.md
  </example>
=====
item-def
- text
  [ref]: @q3.md
=====
item-pipe-table
- text
  | a | b |
  | - | - |
  | @q4.md | x |
=====
top-pipe-table
text
| a | b |
| - | - |
| @q5.md | x |
=====
tag-then-blank
- Review with:
  <checklist>
  @q6.md

  @q7.md
=====
item-tag-attr
- see
  <note kind="x">
  @q8.md
=====
item-tag-inline
- see
  <b>bold</b> @q9.md
=====
quote-item-tag
> - see
>   <tip>
>   @q10.md
=====
top-colon-table
text
a | b
:-- | --
@q11.md | x
=====
single-col
text
a
|---
@q12.md
