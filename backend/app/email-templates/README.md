# E-mailtemplates

`src/*.mjml` are the sources; `build/*.html` is what the app actually sends
(`app/utils.py` → `render_email_template()`). **Both are committed** — the
backend image does not run MJML, so a change to `src/` only ships once the
matching `build/` file is regenerated and committed alongside it.

Rebuild after editing a source:

```bash
cd backend/app/email-templates
npx mjml src/reset_password.mjml -o build/reset_password.html
```

(or `bunx` — the frontend's toolchain already has bun. Built with mjml 5.)

## Two-step rendering

MJML runs at build time; Jinja renders `{{ … }}` at send time. MJML passes the
placeholders through untouched, so the pipeline is
`mjml → build/*.html → Jinja → sent mail`. That means a renamed context key in
`app/utils.py` fails **silently** — Jinja's default undefined renders as an
empty string, so the mail goes out with a blank where the reset link should be.
`backend/tests/test_email_templates.py` guards the contract; run it after
touching either side.

## Styling

The templates follow the vintage road-atlas idiom of the app
(`frontend/src/brommerboek/theme.ts`): paper `#efe4c9` behind a `#f4ecd6` card
with a `#cbb187` border, ochre letterspaced kicker, serif display title, a
dashed `#c0362c` rule echoing the route line, and the red `#a3302a` button.

Deliberately **no remote assets** — no images, no webfonts, no `@import`. The
fonts are the theme's own fallbacks (Georgia, Courier New), so the mail looks
the same whether or not the client blocks remote content, which most do by
default for a first-time sender. If you add an image, host it under
`FRONTEND_HOST` and expect it to be hidden on first open.
