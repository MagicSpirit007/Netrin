# AMap browser-key security proxy

Netrin uses AMap JS API 2.0 in the browser. A browser key is public by design,
but the associated `securityJsCode` must not be committed or embedded in a
production bundle.

## Recommended boundary

1. Configure an AMap Web key with the narrowest practical domain allowlist.
2. Expose a same-origin HTTPS path such as `/_AMapService` through your own
   reverse proxy.
3. Set `VITE_AMAP_KEY` and `VITE_AMAP_SERVICE_HOST` in the frontend build.
4. Keep `VITE_AMAP_SECURITY_JSCODE` empty in production. It exists only for
   temporary local validation.
5. Keep the AMap Web Service key server-side for Edge Functions or the AI
   service; never expose it through `VITE_` variables.

The client configures `security.serviceHost` before loading AMap. The proxy
must preserve AMap response semantics while applying strict request-size,
timeout, origin, and rate limits.

## Generic Nginx sketch

```nginx
location ^~ /_AMapService/ {
    client_max_body_size 64k;
    proxy_connect_timeout 3s;
    proxy_send_timeout 10s;
    proxy_read_timeout 15s;

    proxy_set_header Host restapi.amap.com;
    proxy_set_header Connection "";
    proxy_ssl_server_name on;
    proxy_ssl_name restapi.amap.com;
    proxy_pass https://restapi.amap.com/;
}
```

Review the current AMap security-key documentation before production use.
Validate that the browser bundle contains neither the security code nor the
server-side Web Service key, and retain AMap's required map attribution.
