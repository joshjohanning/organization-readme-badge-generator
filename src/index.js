import core from '@actions/core';
import { graphql } from '@octokit/graphql';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { makeBadge } from 'badge-maker';

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
    describe: 'The number of days',
    type: 'number',
    default: 30
  })
  .option('graphqlUrl', {
    describe: 'The GraphQL URL',
    type: 'string',
    default: 'https://api.github.com/graphql'
  })
  .option('color', {
    describe: 'The color of the badge message (right side)',
    type: 'string',
    default: 'blue'
  })
  .option('labelColor', {
    describe: 'The color of the badge label (left side)',
    type: 'string',
    default: '555'
  })
  .help()
  .parse();

// run via `node src/index.js --organization=joshjohanning-org --token=ghp_abc

let organization;
let token;
let days;
let graphqlUrl;
let color;
let labelColor;
let graphqlWithAuth;

// Only initialize these when running directly (not during tests)
if (process.env.NODE_ENV !== 'test') {
  organization = argv.organization || core.getInput('organization');
  token = argv.token || core.getInput('token');
  days = argv.days || core.getInput('days');
  graphqlUrl = argv.graphqlUrl || core.getInput('graphqlUrl');
  color = argv.color || core.getInput('color') || 'blue';
  labelColor = argv.labelColor || core.getInput('label_color') || '555';

  function requireInput(input) {
    if (!input) {
      throw new Error(`${input} is required`);
    }
  }

  requireInput(organization);
  requireInput(token);

  graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
      baseUrl: graphqlUrl
    }
  });
}

export const generateBadgeMarkdown = (text, number, badgeColor, badgeLabelColor) => {
  const svgBadge = makeBadge({
    label: text,
    message: String(number),
    color: badgeColor,
    labelColor: badgeLabelColor
  });

  // Convert SVG to base64 data URI for markdown
  const base64Badge = Buffer.from(svgBadge).toString('base64');
  const dataUri = `data:image/svg+xml;base64,${base64Badge}`;
  const markdownImage = `![${text}](${dataUri})`;
  return markdownImage;
};

export const getRepositoryCount = async (org, graphqlClient = graphqlWithAuth) => {
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

export const getRepositories = async (org, graphqlClient = graphqlWithAuth) => {
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

export const getPullRequestsCount = async (org, repo, prFilterDate, graphqlClient = graphqlWithAuth) => {
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

    const openPullRequests = pullRequests.filter(
      pr => new Date(pr.createdAt).toISOString().slice(0, 10) >= prFilterDate
    );
    total += openPullRequests.length;

    const mergedPRs = pullRequests.filter(
      pr => pr.state === 'MERGED' && new Date(pr.mergedAt).toISOString().slice(0, 10) >= prFilterDate
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

export const generateBadges = async (orgParam, tokenParam, daysParam, graphqlClient, badgeColor, badgeLabelColor) => {
  const org = orgParam || organization;
  const numDays = daysParam || days;
  const client = graphqlClient || graphqlWithAuth;
  const msgColor = badgeColor || color || 'blue';
  const lblColor = badgeLabelColor || labelColor || '555';

  try {
    // repo count
    const repos = await getRepositories(org, client);
    const repoCount = await getRepositoryCount(org, client);
    core.info(`Total repositories: ${repoCount}`);

    // pull requests
    let totalOpenPRs = 0;
    let totalMergedPRs = 0;

    const date = new Date();
    date.setUTCDate(date.getUTCDate() - numDays);
    const prFilterDate = date.toISOString();
    core.debug(`Filtering PRs created after ${prFilterDate}`);

    for (const repo of repos) {
      const { total, merged } = await getPullRequestsCount(org, repo, prFilterDate, client);
      totalOpenPRs += total;
      totalMergedPRs += merged;
    }

    core.info(`Total open pull requests in last ${numDays} days for ${org}: ${totalOpenPRs}`);
    core.info(`Total merged pull requests in last ${numDays} days for ${org}: ${totalMergedPRs}`);

    const badges = [
      generateBadgeMarkdown(`Total repositories`, repoCount, msgColor, lblColor),
      generateBadgeMarkdown(`Open PRs in last ${numDays} days`, totalOpenPRs, msgColor, lblColor),
      generateBadgeMarkdown(`Merged PRs in last ${numDays} days`, totalMergedPRs, msgColor, lblColor)
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
      const badges = await generateBadges();
      core.info('');
      const badgesMarkdown = badges.join(' ');
      core.info(`Badge markdown: ${badgesMarkdown}`);
      core.setOutput('badges', badgesMarkdown);
    } catch (error) {
      core.error(`Failed to generate badges: ${error.message}`);
      core.error(error.stack);
      process.exit(1);
    }
  })();
}
