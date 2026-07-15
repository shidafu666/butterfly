'use strict';

const http = require('http');
const https = require('https');

const DEFAULT_HEADERS_TIMEOUT_BUFFER_MS = 5000;

function parseTimeout(name) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const keepAliveTimeout = parseTimeout('KEEP_ALIVE_TIMEOUT');
const configuredHeadersTimeout = parseTimeout('HEADERS_TIMEOUT');

function applyTimeouts(server) {
  if (!keepAliveTimeout) {
    return server;
  }

  server.keepAliveTimeout = keepAliveTimeout;
  server.headersTimeout =
    configuredHeadersTimeout || keepAliveTimeout + DEFAULT_HEADERS_TIMEOUT_BUFFER_MS;

  return server;
}

function patchCreateServer(module) {
  const originalCreateServer = module.createServer;

  module.createServer = function patchedCreateServer(...args) {
    return applyTimeouts(originalCreateServer.apply(this, args));
  };
}

patchCreateServer(http);
patchCreateServer(https);

