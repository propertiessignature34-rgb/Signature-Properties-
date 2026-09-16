// The React dev server (:3000) is only an ingress entry point here.
// Every request is transparently proxied to the Signature Realty CRM Node
// server on :3001, which owns all HTML pages, static assets and APIs.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    createProxyMiddleware({
      target: 'http://127.0.0.1:3001',
      changeOrigin: false, // preserve original Host for OAuth origin resolution
      ws: true,
      xfwd: true,
      logLevel: 'warn',
      onProxyReq: (proxyReq, req) => {
        // Preview is always served over HTTPS at the edge.
        proxyReq.setHeader('x-forwarded-proto', 'https');
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (host) {
          proxyReq.setHeader('x-forwarded-host', host);
        }
      },
    })
  );
};
