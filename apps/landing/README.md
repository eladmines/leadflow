# LeadFlow landing page

The company's public page: what LeadFlow is, its features, how it works, a short FAQ, and the
buttons that send people to the app (sign up / sign in). One page, Hebrew (RTL) and English (LTR)
with a switch (Hebrew for Hebrew browsers, English for the rest; the choice is remembered).

Plain HTML, CSS and one small script: no build step, no dependencies, nothing to install.

## Look at it

Open `index.html` in a browser, or serve the folder: `npx serve apps/landing`.

## Change things

- **The app address** (where "Get started" and "Sign in" go): `APP_URL` at the top of `main.js`.
- **Texts:** the Hebrew is written in `index.html` and the English in `main.js` (the `en` object);
  both are keyed by the `data-i18n` name on each element.
- **Name and logo:** the logo is inline SVG in the header; the name is "LeadFlow" in the header,
  footer, title and `main.js`.
- **No prices:** none are stated yet. Add a pricing section when they are decided.

## Put it online (free, separate from the app)

On Render: **New → Static Site**, connect this repository, Publish directory `apps/landing`, no
build command. Every push to `main` then updates the page. Point the company's domain at it
(Settings → Custom Domains). The app can stay on its own address, or move to `app.<domain>`
(then change `APP_URL`).

Not done yet: a contact address, a privacy policy and terms, and real screenshots (the inbox
picture is drawn in HTML and CSS).
