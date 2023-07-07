// imports octokit demo
import { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.141.0/fs/ensure_dir.ts";
import type { Endpoints } from "npm:@octokit/types";
import { Octokit } from "npm:@octokit/core";
import { log } from "../utils/index.ts";

type Args = {
  auth?: string;
  owner: string;
  repo: string;
  useCache: boolean;
  limit: number;
  branch?: string;
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
const SPACER = "\n---\n";

type WorkflowRuns =
  Endpoints["GET /repos/{owner}/{repo}/actions/runs"]["response"]["data"]["workflow_runs"];
type Jobs =
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
): Promise<WorkflowRuns> => {
  if (useCache) {
    return JSON.parse(await cache.get("workflowRuns.json"));
  }
  let page = 0;
  const allWorkflowRuns = [];
  while (true) {
    log("Fetching workflow_runs for page:", page, "info");
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs",
      {
        owner,
        repo,
        per_page: args.limit < 100 ? args.limit : 100,
        page: page++,
        branch: args.branch,
        ...props,
      }
    );
    const runs = response.data.workflow_runs;
    if (runs.length === 0) {
      break;
    }

    const filtered_runs = runs.filter((run) => run.event !== "issues");
    allWorkflowRuns.push(...filtered_runs);

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
  log("Fetching jobs for workflowRunId", workflowRunId, "info");

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
  workflowRuns: WorkflowRuns
): Promise<Jobs> => {
  const allJobs: Jobs = [];
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

const groupAndPrintStats = <T extends WorkflowRuns[number] | Jobs[number]>(
  items: T[],
  getKey: (item: T) => string
) => {
  // Group and count items by key
  const groupedItems = items.reduce((acc: { [key: string]: stats }, item) => {
    const key = getKey(item);
    if (!acc[key]) {
      acc[key] = {
        total: 0,
        failures: 0,
      };
    }
    acc[key]["total"] += 1;

    if (item.conclusion === "failure") {
      acc[key]["failures"] += 1;
    }
    return acc;
  }, {});

  // Sort items by failure count
  const sortedItems = Object.entries(groupedItems).sort(
    (a, b) => b[1].failures - a[1].failures
  );

  // Print out results
  log("By failure count:");
  sortedItems.forEach(([itemName, stats]) => {
    if (stats.failures === 0) {
      return;
    }

    log(itemName, `${stats.failures} of ${stats.total}`, "log");
  });
};

// ----- MAIN APP -----

const main = async () => {
  const allWorkflowRuns = await getWorkflowRuns({
    // Uncomment to filter failed workflow runs
    // status: "failure",
  });

  // % of failures in the workflow runs
  const failures: WorkflowRuns = allWorkflowRuns.filter((workflowRun) => {
    return workflowRun.conclusion === "failure";
  });

  const distribution = allWorkflowRuns.reduce(
    (acc: { [key: string]: number }, workflowRun) => {
      const conclusion =
        workflowRun.conclusion || workflowRun.status || "No status";
      if (!acc[conclusion]) {
        acc[conclusion] = 0;
      }
      acc[conclusion] += 1;
      return acc;
    },
    {}
  );

  log(`\nDistribution of workflow runs:`);

  for (const [conclusion, count] of Object.entries(distribution)) {
    const colors = {
      failure: "red",
      success: "green",
      skipped: "grey",
      in_progress: "blue",
    };
    const color = colors[conclusion as keyof typeof colors] || "inherit";
    console.log(
      `%c${conclusion}: ${count}, ${(
        (count * 100) /
        allWorkflowRuns.length
      ).toFixed(2)}%\r`,
      `color: ${color}; font-weight: bold`
    );
  }
  console.log(SPACER);

  // Group workflow runs by name and print stats
  groupAndPrintStats(
    allWorkflowRuns,
    (workflowRun) => workflowRun.name || "No name"
  );

  console.log(SPACER);

  // get all jobs for each workflow run that failed
  const allJobs = await getAllWorkflowJobs(failures);

  // Get all failed jobs
  const failedJobs = allJobs.filter((job) => {
    return job.conclusion === "failure";
  });
  log(
    "Jobs that failed in the failed workflows:",
    `${failedJobs.length} of ${allJobs.length} jobs or ${(
      (failedJobs.length * 100) /
      allJobs.length
    ).toFixed(2)}%`,
    "log"
  );

  console.log(SPACER);

  // Group jobs by name and failure count
  groupAndPrintStats(allJobs, (job) =>
    job.name.startsWith("Run backwards compatibility tests")
      ? "Backwards compatibility tests on all versions"
      : job.name
  );
};

main();
