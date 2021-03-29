const proxy = require('http-proxy-middleware').createProxyMiddleware;
const Bundler = require('parcel-bundler');
const express = require('express');

const bundler = new Bundler('./client/video_overlay.html');
const app = express();

app.use(
    '/api',
    proxy({
        target: process.env.PORT || 'http://localhost:3000/'
    })
);

app.use(bundler.middleware());

app.listen(Number(process.env.FRONTEND_PORT || 1234));
