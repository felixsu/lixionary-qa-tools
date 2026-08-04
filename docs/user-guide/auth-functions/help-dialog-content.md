# Auth Functions — in-app helper content

> **How to publish this:** in **User Guide admin**, create a guide titled
> "How auth functions work" with slug **`page-auth-functions`** and paste
> everything below the divider into a **markdown block**. The help button in
> the Auth Functions action bar renders it automatically. (Mermaid blocks can
> be added alongside if you want a token-flow diagram.)
>
> For Browser Profiles, do the same with slug **`page-browser-profiles`**
> using the content of `docs/user-guide/browser-profiles/general.md`.
>
> This file preserves the previously hardcoded in-app help dialog, which was
> replaced by the slug-based User Guide helper in 0.4.1.

---

An auth function is a small sandboxed JavaScript script that fetches an authorization token on demand. The returned token is cached on this device and reused until it expires, then the script runs again automatically.

## fetchToken(url, options)

The sandbox provides `fetchToken` for HTTP calls. It is synchronous — no `await` needed — and returns the raw response body as a **string**, which is why every example calls `JSON.parse(response)`. Options:

- `method` — GET, POST, PUT or DELETE (defaults to GET).
- `headers` — object of request headers.
- `body` — a string is sent as-is (use this for form-urlencoded payloads); an object is sent as JSON.

## Environment variables

`env.MY_VAR` reads a variable from the currently selected environment. Store client IDs, secrets and passwords there instead of hardcoding them in the script — the same function then works across environments.

## What to return

Return the token string directly (`return data.access_token`), or an object when you need several values (`return { access_token, refresh_token }`). Returning `undefined` or `null` is an error — check that the field you read exists in the response. Set the **Expires-in** field to control how long the token is cached; leave it empty for JWTs, whose expiry is detected automatically.

## Example

```js
// 1. Call the token endpoint. Secrets are best kept in the
//    selected environment and read via env.*
const response = fetchToken("https://api.ninjavan.dev/sg/aaa/2.0/oauth/access_token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    grant_type: "client_credentials"
  })
});

// 2. fetchToken returns the raw response body as a string
const data = JSON.parse(response);

// 3. Return the token (or an object holding several tokens)
return data.access_token;
```

## Tips

- Use the **Use a preset...** picker in the create dialog to start from a known Ninja Van service (Operator V2, Shipper, Driver, Ninja Mart, PUDO) — then replace the placeholder credentials.
- Click **Test script** before saving to run the script against the selected environment and see the token (or the error) immediately.
- To debug, temporarily `return` the value you want to inspect (e.g. `return response`) and run Test script to see it.
