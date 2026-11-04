'use strict';

/**
 * proxyMeshService.js - Residential Proxy Rotation & Stealth Fingerprint Mesh
 * Manages proxy pools, round-robin IP rotation, and HTTP/2 TLS Client Hello browser fingerprints.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
];

const PROXY_NODES = [
  { id: 'node-in-del-01', ip: '103.21.244.12', region: 'IN-DEL', type: 'Residential', provider: 'BrightData', latencyMs: 42, health: 99.8 },
  { id: 'node-in-bom-02', ip: '45.118.160.88', region: 'IN-BOM', type: 'Residential', provider: 'Oxylabs', latencyMs: 38, health: 100.0 },
  { id: 'node-in-blr-03', ip: '117.250.18.45', region: 'IN-BLR', type: 'Residential', provider: 'Smartproxy', latencyMs: 45, health: 99.5 },
  { id: 'node-in-ccu-04', ip: '103.87.56.91', region: 'IN-CCU', type: 'Residential', provider: 'BrightData', latencyMs: 51, health: 98.9 },
  { id: 'node-in-hyd-05', ip: '182.73.190.14', region: 'IN-HYD', type: 'Residential', provider: 'Oxylabs', latencyMs: 40, health: 99.7 }
];

let proxyIndex = 0;

function getNextProxy() {
  const node = PROXY_NODES[proxyIndex % PROXY_NODES.length];
  proxyIndex++;
  return {
    ...node,
    timestamp: new Date().toISOString()
  };
}

function generateStealthFingerprint() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const isChrome = ua.includes('Chrome');

  return {
    userAgent: ua,
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Sec-Ch-Ua': isChrome ? '"Not)A;Brand";v="99", "Google Chrome";v="128", "Chromium";v="128"' : undefined,
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    },
    screenResolution: '1920x1080',
    viewport: { width: 1920, height: 1080 },
    deviceMemory: 8,
    hardwareConcurrency: 8,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'
  };
}

function getMeshStatus() {
  return {
    success: true,
    totalNodes: PROXY_NODES.length,
    activeNodes: PROXY_NODES.filter(n => n.health > 95).length,
    rotationStrategy: 'Round-Robin Residential Mesh',
    fingerprintEngine: 'Playwright Chromium Stealth v2',
    nodes: PROXY_NODES
  };
}

module.exports = {
  getNextProxy,
  generateStealthFingerprint,
  getMeshStatus
};
