# SimpleCatch landing page

The company's public page: what SimpleCatch is, its features, how it works, a short FAQ, and the
buttons that send people to the app (sign up / sign in). One page, Hebrew (RTL) and English (LTR)
with a switch (Hebrew for Hebrew browsers, English for the rest; the choice is remembered).

Plain HTML, CSS and one small script: no build step, no dependencies, nothing to install.

## Look at it

Open `index.html` in a browser, or serve the folder: `npx serve apps/landing`.

## Change things

- **The app address** (where "Get started" and "Sign in" go): `APP_URL` at the top of `main.js`.
- **Texts:** the Hebrew is written in `index.html` and the English in `main.js` (the `en` object);
  both are keyed by the `data-i18n` name on each element.
- **Name and logo:** the logo is `logo.svg` (the wordmark) and `icon-c.svg`, both from `docs/brand/`;
  the favicon is `favicon.svg`. The name is "SimpleCatch" in the title and `main.js`.
- **Prices:** the pricing section (mock plans) is off the page for now; its texts are still in `main.js` (`pl*` keys), and the section is in git history (before the commit that removed it). Bring it back once pricing is decided (F13).

## Put it online (Cloudflare Workers, live at https://simplecatch.co.il)

The page is served by a Cloudflare Worker with static assets, named `simplecatch-landing`, on the
custom domains `simplecatch.co.il` and `www.simplecatch.co.il` (zone on the Free plan; the `www`
address redirects to the root with a 301 Redirect Rule, and Always Use HTTPS is on).

- **Deploy command** (also the one in Workers Builds, from the repo root; every push to `main` runs it):
  `npx wrangler deploy --assets=apps/landing --name simplecatch-landing --compatibility-date=2026-11-01`
- **`.assetsignore`** keeps `ad/` (video sources) and this `README.md` out of the public site. Add any
  new non-public file or folder there.
- **After a deploy,** check `https://simplecatch.co.il` (logo, language switch) and that
  `https://simplecatch.co.il/ad/` and `/README.md` return 404.
- The static service `simplecatch-landing` in `render.yaml` is an older, optional copy of the same page
  (on `onrender.com`). The real address is the Cloudflare one.
- The app still lives at its own address (`APP_URL` in `main.js`); when it moves to `app.simplecatch.co.il`,
  change `APP_URL`.

Legal pages: `privacy.html`, `terms.html` and `data-deletion.html` (Hebrew and English in the same file, switched by `legal.js`, styled by `legal.css`). They are drafts written from how the app handles data (not legal advice: have them reviewed, O-007) and give `support@simplecatch.co.il` as the contact. They are the URLs Meta (privacy policy, terms, data deletion) and Google (OAuth consent screen) ask for.

Not done yet: real screenshots (the inbox
picture is drawn in HTML and CSS).

Note: the `#reviews` section is mock (sample quotes, labelled as illustrative). Replace with real, permitted customer quotes before relying on it.
