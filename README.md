# Ferret translations

[![Translation status](https://hosted.weblate.org/widget/ferret/svg-badge.svg)](https://hosted.weblate.org/engage/ferret/)

Translations of [Ferret](https://github.com/ferret-project/ferret), the self-hosted home inventory, made by the people
who use it.

Ferret is written in English, and English is the only language its maintainers keep up. Every other language lives
here and belongs to its translators. When Ferret adds something new, its English text shows up here automatically, and
until someone translates it, it shows in English.

## How it fits together

- `locales/messages.pot` is every piece of text in Ferret's app, in English. Ferret's CI updates it whenever the app's
  text changes. Don't edit it by hand.
- `locales/<language>.po` is one language: `de.po`, `hu.po`, `pt-BR.po`… Each holds that language's translations
  of the strings in `messages.pot`.
- Every Ferret build (the Docker image, the demo, hosted Ferret) fetches this repository and includes every language
  in it. A language shows up by itself (picked from the browser's language) once it's at least **80%** translated.
  Below that, people can still choose it under Language in the account menu, where it says how far along it is.

## Translating

**On Weblate (easiest):** [hosted.weblate.org/projects/ferret](https://hosted.weblate.org/projects/ferret/). Sign
in, pick your language (or start a new one), and translate in the browser. No git, no files. Weblate commits your work
here by itself, and it flags a broken placeholder or plural as you type.

**On GitHub:** copy `locales/messages.pot` to `locales/<language>.po` for a new language, or edit an existing one,
then open a pull request. Any PO editor works (Poedit, Lokalize, a text editor). If the language is also being
translated on Weblate, prefer Weblate, so two people don't edit the same file at once.

Pick the language in Ferret's account menu (Language) to see your work in context.

### Rules for the text

- **Keep the placeholders exactly as they are:** `{name}`, `{count}`, `{0}`. You can move them around in the
  sentence, but don't translate or change them.
- **Keep the tags:** `<0>…</0>`, `<1>…</1>` wrap a link or bold text. Translate the words inside, keep the tags.
- **Plurals** look like `{count, plural, one {# thing} other {# things}}`. Translate the words inside the braces,
  keep `plural`, `one`, `other` and `#`, and add the forms your language needs (`few`, `many`…).
- Keep the tone short and plain, like Ferret's English: "Add to cart", not "Click here to add this item to your
  shopping cart".
- Don't translate the names Ferret, Home Assistant, Claude or Amazon.

### Trying your translation in Ferret

With a clone of Ferret and of this repository side by side:

```bash
cd ferret
pnpm install
FERRET_TRANSLATIONS_DIR=../ferret-translations pnpm --filter @ferret/web translations prepare
pnpm dev
```

(`pnpm dev` needs a `.env`; Ferret's README says how.)

## Languages

| Language | Maintainers |
| -------- | ----------- |
| _yours?_ | Open an issue to start a language, or to help look after one. |

Each language is looked after by its own translators, who review changes to it. Ferret's maintainers don't review
translations they can't read.

## License

MIT, like Ferret. By contributing a translation you agree to it being used under that license.
