import core from '@actions/core';
import { graphql } from '@octokit/graphql';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Default values
const DEFAULT_DAYS = 30;
const DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql';
const DEFAULT_COLOR = 'blue';
const DEFAULT_LABEL_COLOR = '555';

const argv = yargs(hideBin(process.argv))
  .option('organization', {
    describe: 'The organization',
    type: 'string'
  })
  .option('token', {
    describe: 'The token',
    type: 'string'
  })
  .option('days', {
    describe: `The number of days (default: ${DEFAULT_DAYS})`,
    type: 'number'
  })
  .option('graphqlUrl', {
    describe: `The GraphQL URL (default: ${DEFAULT_GRAPHQL_URL})`,
    type: 'string'
  })
  .option('color', {
    describe: `The color of the badge message (right side) (default: ${DEFAULT_COLOR})`,
    type: 'string'
  })
  .option('labelColor', {
    describe: `The color of the badge label (left side) (default: ${DEFAULT_LABEL_COLOR})`,
    type: 'string'
  })
  .wrap(null) // Use full terminal width for better formatting
  .version()
  .help()
  .parse();

// run via `node src/index.js --organization=joshjohanning-org --token=ghp_abc

// Exported function for validating required inputs
export function validateRequiredInput(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  return input;
}

/**
 * Creates a GraphQL client with authentication
 * @param {string} authToken - The authentication token
 * @param {string} [baseUrl] - Optional custom GraphQL URL
 * @returns {function} The configured GraphQL client
 */
export function createGraphqlClient(authToken, baseUrl = DEFAULT_GRAPHQL_URL) {
  let client = graphql.defaults({
    headers: {
      authorization: `token ${authToken}`
    }
  });

  // Set baseUrl if a custom GraphQL URL is provided
  if (baseUrl && baseUrl !== DEFAULT_GRAPHQL_URL) {
    client = client.defaults({
      baseUrl: baseUrl
    });
  }

  return client;
}

/**
 * Initializes configuration from command line arguments or GitHub Actions inputs
 * @returns {{organization: string, token: string, days: number, graphqlUrl: string, color: string, labelColor: string, graphqlClient: function}} Configuration object
 */
export function initializeConfig() {
  const org = argv.organization || core.getInput('organization');
  const tkn = argv.token || core.getInput('token');
  const numDays = argv.days || core.getInput('days') || DEFAULT_DAYS;
  const gqlUrl = argv.graphqlUrl || core.getInput('graphql_url') || DEFAULT_GRAPHQL_URL;
  const badgeColor = argv.color || core.getInput('color') || DEFAULT_COLOR;
  const badgeLabelColor = argv.labelColor || core.getInput('label_color') || DEFAULT_LABEL_COLOR;

  validateRequiredInput(org, 'organization');
  validateRequiredInput(tkn, 'token');

  const client = createGraphqlClient(tkn, gqlUrl);

  return {
    organization: org,
    token: tkn,
    days: numDays,
    graphqlUrl: gqlUrl,
    color: badgeColor,
    labelColor: badgeLabelColor,
    graphqlClient: client
  };
}

/**
 * Main execution function that generates badges and sets outputs
 * @param {object} [config] - Optional configuration object (uses initializeConfig if not provided)
 * @returns {Promise<string[]>} Array of badge markdown strings
 */
export async function run(config) {
  const cfg = config || initializeConfig();

  const badges = await generateBadges(
    cfg.organization,
    cfg.token,
    cfg.days,
    cfg.graphqlClient,
    cfg.color,
    cfg.labelColor
  );
  core.info('');
  const badgesMarkdown = badges.join(' ');
  core.info(`Badge markdown: ${badgesMarkdown}`);
  core.setOutput('badges', badgesMarkdown);

  return badges;
}

export const generateBadgeMarkdown = (text, number, badgeColor, badgeLabelColor) => {
  // Use shields.io for GitHub-compatible badge rendering
  const encodedLabel = encodeURIComponent(text);
  const encodedMessage = encodeURIComponent(number);
  const encodedColor = encodeURIComponent(badgeColor);
  const encodedLabelColor = encodeURIComponent(badgeLabelColor);

  const badgeUrl = `https://img.shields.io/badge/${encodedLabel}-${encodedMessage}-${encodedColor}?labelColor=${encodedLabelColor}`;
  const markdownImage = `![${text}](${badgeUrl})`;
  return markdownImage;
};

export const getRepositoryCount = async (org, graphqlClient) => {
  const { organization: orgData } = await graphqlClient(
    `
    query ($organization: String!) {
      organization (login: $organization) {
        repositories {
          totalCount
        }
      }
    }
  `,
    { organization: org }
  );

  return orgData.repositories.totalCount;
};

export const getRepositories = async (org, graphqlClient) => {
  let endCursor;
  let hasNextPage = true;
  const repositories = [];

  while (hasNextPage) {
    const { organization: orgData } = await graphqlClient(
      `
      query ($organization: String!, $after: String) {
        organization (login: $organization) {
          repositories(first: 100, after: $after) {
            nodes {
              name
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `,
      { organization: org, after: endCursor }
    );

    repositories.push(...orgData.repositories.nodes.map(repo => repo.name));

    hasNextPage = orgData.repositories.pageInfo.hasNextPage;
    endCursor = orgData.repositories.pageInfo.endCursor;
  }

  return repositories;
};

export const getPullRequestsCount = async (org, repo, prFilterDate, graphqlClient) => {
  let endCursor;
  let hasNextPage = true;
  let total = 0;
  let merged = 0;

  while (hasNextPage) {
    const { repository } = await graphqlClient(
      `
      query ($org: String!, $repo: String!, $after: String) {
        repository(owner: $org, name: $repo) {
          pullRequests(first: 100, after: $after) {
            nodes {
              createdAt
              mergedAt
              state
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `,
      { org, repo, after: endCursor }
    );

    const pullRequests = repository.pullRequests.nodes;

    const openPullRequests = pullRequests.filter(pr => new Date(pr.createdAt) >= new Date(prFilterDate));
    total += openPullRequests.length;

    const mergedPRs = pullRequests.filter(
      pr => pr.state === 'MERGED' && new Date(pr.mergedAt) >= new Date(prFilterDate)
    );
    merged += mergedPRs.length;

    hasNextPage = repository.pullRequests.pageInfo.hasNextPage;
    endCursor = repository.pullRequests.pageInfo.endCursor;
  }

  return {
    total,
    merged
  };
};

/**
 * Processes pull request counts for multiple repositories in batches with limited concurrency
 * @param {string} org - The organization name
 * @param {string[]} repos - Array of repository names to process
 * @param {string} prFilterDate - ISO date string to filter PRs created after this date
 * @param {function} client - GraphQL client for API calls
 * @param {number} [batchSize=10] - Number of repositories to process concurrently per batch
 * @returns {Promise<{totalOpenPRs: number, totalMergedPRs: number}>} The aggregated PR counts
 */
export const processPullRequestsInBatches = async (org, repos, prFilterDate, client, batchSize = 10) => {
  let totalOpenPRs = 0;
  let totalMergedPRs = 0;

  // Process repositories in batches
  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize);

    // Process each batch concurrently
    const results = await Promise.all(batch.map(repo => getPullRequestsCount(org, repo, prFilterDate, client)));

    // Aggregate results from the batch
    for (const { total, merged } of results) {
      totalOpenPRs += total;
      totalMergedPRs += merged;
    }
  }

  return {
    totalOpenPRs,
    totalMergedPRs
  };
};

export const generateBadges = async (org, tokenParam, numDays, graphqlClient, badgeColor, badgeLabelColor) => {
  const msgColor = badgeColor || DEFAULT_COLOR;
  const lblColor = badgeLabelColor || DEFAULT_LABEL_COLOR;
  const daysCount = numDays || DEFAULT_DAYS;
  let client = graphqlClient;
  if (!client && tokenParam) {
    client = createGraphqlClient(tokenParam, argv.graphqlUrl || DEFAULT_GRAPHQL_URL);
  }

  try {
    // repo count
    const repos = await getRepositories(org, client);
    const repoCount = repos.length;
    core.info(`Total repositories: ${repoCount}`);
    // pull requests
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysCount);
    const prFilterDate = date.toISOString();
    core.debug(`Filtering PRs created after ${prFilterDate}`);

    const { totalOpenPRs, totalMergedPRs } = await processPullRequestsInBatches(org, repos, prFilterDate, client);

    core.info(`Total pull requests created in last ${daysCount} days for ${org}: ${totalOpenPRs}`);
    core.info(`Total merged pull requests in last ${daysCount} days for ${org}: ${totalMergedPRs}`);

    const badges = [
      generateBadgeMarkdown(`Total repositories`, repoCount, msgColor, lblColor),
      generateBadgeMarkdown(`PRs created in last ${daysCount} days`, totalOpenPRs, msgColor, lblColor),
      generateBadgeMarkdown(`Merged PRs in last ${daysCount} days`, totalMergedPRs, msgColor, lblColor)
    ];

    return badges;
  } catch (error) {
    core.error(error.stack);
    process.exit(1);
  }
};

// Only run when executed directly (not when imported for tests)
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await run();
    } catch (error) {
      core.error(`Failed to generate badges: ${error.message}`);
      core.error(error.stack);
      process.exit(1);
    }
  })();
}
