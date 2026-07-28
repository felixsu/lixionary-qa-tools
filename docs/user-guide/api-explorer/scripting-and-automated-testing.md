# **Scripting & Automated Testing**

## **Overview**

API Explorer provides JavaScript-based pre-request processing (**Interceptor**) and post-request verification (**Test**) capabilities. Scripts run in a secure sandbox — there is no network access (`fetch`), no `URL`/`URLSearchParams`, and no Postman `pm.*` API.

## **1. Interceptor (Pre-Request Scripts)**

The **Interceptor** tab executes custom JavaScript logic *before* the request is transmitted across the network — after all {{env.X}}, {{input}}, and {{$...}} tokens are interpolated and after auth is resolved, so the script sees (and can modify) the final request including its Authorization header. It also runs when generating cURL or Python previews.

* **Use Cases**:
  * Calculating cryptographic signatures or HMAC hashes on the fly.
  * Deriving dynamic header or payload values from environment variables.
  * Modifying request headers or transforming payload structure dynamically before dispatch.

* **Available Globals**:
  * request: Mutable request object — changes to request.url, request.headers, request.params, and request.body are applied before dispatch (request.method and request.bodyType are read-only context; request.body is a raw string).
  * env: Read-only object of the active environment's variables.
  * crypto: Helpers crypto.hmac(algorithm, secret, message, encoding?), crypto.hash(algorithm, message, encoding?), crypto.base64Encode(value), crypto.base64Decode(value). Algorithms: sha256, sha1, sha512, md5; encoding "hex" (default) or "base64".

* **Behavior**: A script error aborts the request with an execution-failure message. For dynamic timestamps prefer the {{$date...}} generator tokens; there is no built-in UUID helper.

## **2. Test (Post-Request Assertions)**

The **Test** tab runs JavaScript assertion logic immediately after receiving an API response — regardless of HTTP status, so you can assert on error responses too.

### **Predefined Global Objects**

* request: Read-only representation of the final resolved request (method, url, headers, params, body, bodyType). The body is JSON-parsed when possible.
* response: The server response context, containing:
  * response.status (number)
  * response.statusText (string)
  * response.headers (object)
  * response.body (parsed JSON object or raw string)
* outputs: The object produced by the Output tab's parser script, if any.
* test(description: string, condition: boolean): Assertion helper function — pass a truthy/falsy condition, not a callback.

Results appear as PASS/FAIL rows in the **Tests** response tab. If the script throws, assertions recorded before the error are kept and the error message is shown alongside them.

### **Code Example**

```javascript
if (response && response.body) {
  var body = response.body;
  var order_id = body.id;
  var transactions = body.transactions;
  var last_transaction = transactions[transactions.length - 1];
  var waypoint_id = last_transaction.waypointId;

  // Execute test assertions
  test("Order ID exists", order_id != null);
  test("Waypoint ID is not null", waypoint_id != null);
}
```
