// imports octokit demo
import { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.141.0/fs/ensure_dir.ts";
import type { Endpoints } from "npm:@octokit/types";
import { Octokit } from "npm:@octokit/core";

type Args = {
  auth?: string;
  owner: string;
  repo: string;
  useCache: boolean;
  limit: number;
};

const args: Args = parse(Deno.args, {
  default: {
    owner: "opensearch-project",
    repo: "OpenSearch-Dashboards",
    useCache: false,
    limit: 300,
  },
});

// Create a new client
const octokit = new Octokit({
  auth: args.auth,
});

const owner = args.owner;
const repo = args.repo;
const useCache = args.useCache;

type workflowRuns =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"];
type jobs =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"]["response"]["data"]["jobs"];

interface stats {
  total: number;
  failures: number;
}

const cache = {
  _dir: "./cache",
  set: async (data: string, fileName = "cache.json") => {
    ensureDirSync(cache._dir);

    await Deno.writeTextFile(`${cache._dir}/${fileName}`, data, {
      create: true,
    });
  },
  get: async (fileName = "cache.json") => {
    return await Deno.readTextFile(`${cache._dir}/${fileName}`);
  },
};

// Get all failed workflow runs
const getWorkflowRuns = async (
  props?: Partial<
    Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["parameters"]
  >
): Promise<workflowRuns> => {
  if (useCache) {
    return JSON.parse(await cache.get("workflowRuns.json"));
  }
  let page = 0;
  const allWorkflowRuns = [];
  while (true) {
    console.log(`page: ${page}\r`);
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs",
      {
        owner,
        repo,
        per_page: args.limit < 100 ? args.limit : 100,
        page: page++,
        ...props,
      }
    );
    const runs = response.data.workflow_runs;
    if (runs.length === 0) {
      break;
    }

    allWorkflowRuns.push(...runs);

    if (allWorkflowRuns.length >= args.limit) {
      break;
    }
  }

  // cache data to file
  const data = JSON.stringify(allWorkflowRuns);
  cache.set(data, "workflowRuns.json");

  return allWorkflowRuns;
};

// Get all jobs for a workflow run
const getWorkflowJobs = async (workflowRunId: number) => {
  console.log(`Fetching jobs for workflowRunId:${workflowRunId}\r`);

  let page = 0;
  const allJobs = [];
  while (true) {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      {
        owner,
        repo,
        run_id: workflowRunId,
        per_page: 100,
        page: page++,
      }
    );
    const jobs = response.data.jobs;
    if (jobs.length === 0) {
      break;
    }

    allJobs.push(...jobs);
  }

  return allJobs;
};

const getAllWorkflowJobs = async (
  workflowRuns: workflowRuns
): Promise<jobs> => {
  const allJobs: jobs = [];
  if (useCache) {
    return JSON.parse(await cache.get("jobs.json"));
  }

  for (const workflowRun of workflowRuns) {
    const jobs = await getWorkflowJobs(workflowRun.id);
    allJobs.push(...jobs);
  }

  // Cache data to file
  const data = JSON.stringify(allJobs);
  cache.set(data, "jobs.json");

  return allJobs;
};

const main = async () => {
  const allWorkflowRuns = await getWorkflowRuns({
    // status: "failure",
  });

  // % of failures in the workflow runs
  const failures: workflowRuns = allWorkflowRuns.filter((workflowRun) => {
    return workflowRun.conclusion === "failure";
  });
  console.log(
    `% of workflows that failed: ${(
      (failures.length * 100) /
      allWorkflowRuns.length
    ).toFixed(2)}%`
  );

  // get all jobs for each workflow run that failed
  const allJobs = await getAllWorkflowJobs(failures);

  // Get all failed jobs
  const failedJobs = allJobs.filter((job) => {
    return job.conclusion === "failure";
  });
  console.log(
    `Jobs that failed in the failed workflows: ${failedJobs.length} of ${
      allJobs.length
    } jobs or ${((failedJobs.length * 100) / allJobs.length).toFixed(2)}%\n`
  );

  // Group jobs by name and failure count
  const groupedJobs = allJobs.reduce((acc: { [key: string]: stats }, job) => {
    const key = job.name.startsWith("Run backwards compatibility tests")
      ? "Backwards compatibility tests on all versions"
      : job.name;
    if (!acc[key]) {
      acc[key] = {
        total: 0,
        failures: 0,
      };
    }
    acc[key]["total"] += 1;

    if (job.conclusion === "failure") {
      acc[key]["failures"] += 1;
    }
    return acc;
  }, {});

  // Sort jobs by failure percentage
  const sortedJobs = Object.entries(groupedJobs).sort(
    (a, b) => b[1].failures - a[1].failures
  );

  // Print out results
  console.log("Jobs by failure count:");
  sortedJobs.forEach(([jobName, stats]) => {
    if (stats.failures === 0) {
      return;
    }

    console.log(
      jobName,
      "\t",
      `failures: ${stats.failures}, total: ${stats.total}`
    );
  });
};

main();
