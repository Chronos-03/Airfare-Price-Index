'use strict';

/**
 * scrapeQueueService.js - Distributed Task Queue & Worker Batch Dispatcher
 * Redis/Memory backed distributed job queue for parallel multi-carrier scraping tasks.
 */

const { getNextProxy, generateStealthFingerprint } = require('./proxyMeshService');

const jobsQueue = [];
let jobCounter = 1001;

function dispatchScrapeJob(payload) {
  const route = payload.route || 'DEL-BOM';
  const carrier = payload.carrier || 'ALL';
  const windowDays = payload.windowDays || 30;

  const proxy = getNextProxy();
  const fingerprint = generateStealthFingerprint();

  const job = {
    id: `JOB-${jobCounter++}`,
    route,
    carrier,
    windowDays,
    status: 'QUEUED',
    priority: payload.priority || 'HIGH',
    proxyNode: proxy.id,
    proxyIp: proxy.ip,
    userAgent: fingerprint.userAgent,
    createdAt: new Date().toISOString(),
    completedAt: null,
    extractedCount: 0
  };

  jobsQueue.unshift(job);

  // Simulate worker async processing
  setTimeout(() => {
    job.status = 'RUNNING';
    setTimeout(() => {
      job.status = 'COMPLETED';
      job.completedAt = new Date().toISOString();
      job.extractedCount = carrier === 'ALL' ? windowDays * 4 : windowDays;
    }, 1500);
  }, 500);

  return job;
}

function getQueueStatus() {
  const queued = jobsQueue.filter(j => j.status === 'QUEUED').length;
  const running = jobsQueue.filter(j => j.status === 'RUNNING').length;
  const completed = jobsQueue.filter(j => j.status === 'COMPLETED').length;

  return {
    success: true,
    totalJobs: jobsQueue.length,
    activeWorkers: 4,
    metrics: {
      queued,
      running,
      completed,
      avgProcessingTimeMs: 1850
    },
    recentJobs: jobsQueue.slice(0, 10)
  };
}

module.exports = {
  dispatchScrapeJob,
  getQueueStatus
};
