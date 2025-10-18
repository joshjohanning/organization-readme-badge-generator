import core from '@actions/core';
import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import { makeBadge } from 'badge-maker';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';

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
  .option('badgePath', {
    describe: 'The path where badge SVG files should be saved',
    type: 'string'
  })
  .option('commitBadges', {
    describe: 'Whether to commit badge files to the repository',
    type: 'boolean'
  })
  .option('readmePath', {
    describe: 'The path to the README file to update',
    type: 'string'
  })
  .option('updateReadme', {
    describe: 'Whether to update the README file with badge references',
    type: 'boolean'
  })
  .wrap(null) // Use full terminal width for better formatting
  .version()
  .help()
  .parse();

// run via `node src/index.js --organization=joshjohanning-org --token=ghp_abc

let organization;
let token;
let days;
let graphqlUrl;
let color;
let labelColor;
let badgePath;
let commitBadges;
let readmePath;
let updateReadme;
let graphqlWithAuth;
let octokit;

// Exported function for validating required inputs
export function validateRequiredInput(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  return input;
}

// Only initialize these when running directly (not during tests)
if (process.env.NODE_ENV !== 'test') {
  organization = argv.organization || core.getInput('organization');
  token = argv.token || core.getInput('token');
  days = argv.days || core.getInput('days') || 30;
  graphqlUrl = argv.graphqlUrl || core.getInput('graphql_url') || 'https://api.github.com/graphql';
  color = argv.color || core.getInput('color') || 'blue';
  labelColor = argv.labelColor || core.getInput('label_color') || '555';
  badgePath = argv.badgePath || core.getInput('badge_path') || 'badges';
  commitBadges = argv.commitBadges || core.getInput('commit_badges') === 'true';
  readmePath = argv.readmePath || core.getInput('readme_path') || 'profile/README.md';
  updateReadme = argv.updateReadme || core.getInput('update_readme') === 'true';

  validateRequiredInput(organization, 'organization');
  validateRequiredInput(token, 'token');

  graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${token}`
    }
  });

  // Set baseUrl if a custom GraphQL URL is provided
  if (graphqlUrl && graphqlUrl !== 'https://api.github.com/graphql') {
    graphqlWithAuth = graphqlWithAuth.defaults({
      baseUrl: graphqlUrl
    });
  }

  // Initialize Octokit for REST API operations
  octokit = new Octokit({
    auth: token,
    baseUrl: graphqlUrl.replace('/graphql', '')
  });
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

export const generateBadgeSVG = (text, number, badgeColor, badgeLabelColor) => {
  // Generate SVG using badge-maker
  const format = {
    label: text,
    message: String(number),
    color: badgeColor,
    labelColor: badgeLabelColor
  };
  return makeBadge(format);
};

export const sanitizeFilename = filename => {
  // Remove or replace characters that are invalid in filenames
  return filename
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase();
};

export const saveBadgeSVG = (badgeName, svgContent, badgeDir) => {
  // Ensure badge directory exists
  if (!fs.existsSync(badgeDir)) {
    fs.mkdirSync(badgeDir, { recursive: true });
  }

  const filename = `${sanitizeFilename(badgeName)}.svg`;
  const filepath = path.join(badgeDir, filename);
  fs.writeFileSync(filepath, svgContent, 'utf8');
  core.info(`Saved badge to ${filepath}`);
  return filepath;
};

export const getFileContent = async (owner, repo, filePath, octokitClient) => {
  try {
    const { data } = await octokitClient.repos.getContent({
      owner,
      repo,
      path: filePath
    });
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha
    };
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
};

export const commitFile = async (owner, repo, filePath, content, message, octokitClient) => {
  try {
    // Check if file exists to get its SHA
    const existingFile = await getFileContent(owner, repo, filePath, octokitClient);

    const params = {
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64')
    };

    // If file exists, include its SHA for update
    if (existingFile) {
      params.sha = existingFile.sha;
    }

    const { data } = await octokitClient.repos.createOrUpdateFileContents(params);
    core.info(`Committed ${filePath} to repository`);
    return data;
  } catch (error) {
    core.error(`Failed to commit ${filePath}: ${error.message}`);
    throw error;
  }
};

export const updateReadmeWithBadges = async (owner, repo, readmeFilePath, badgeReferences, octokitClient) => {
  try {
    const existingReadme = await getFileContent(owner, repo, readmeFilePath, octokitClient);

    if (!existingReadme) {
      core.warning(`README file not found at ${readmeFilePath}`);
      return null;
    }

    const startMarker = '<!-- start organization badges -->';
    const endMarker = '<!-- end organization badges -->';

    const { content } = existingReadme;

    // Check if markers exist
    if (!content.includes(startMarker) || !content.includes(endMarker)) {
      core.warning(`README does not contain badge markers (${startMarker} and ${endMarker}). Skipping README update.`);
      return null;
    }

    // Replace content between markers
    const regex = new RegExp(
      `${startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'g'
    );

    const newContent = content.replace(regex, `${startMarker}\n${badgeReferences}\n${endMarker}`);

    // Only update if content changed
    if (newContent === content) {
      core.info('README content unchanged, skipping update');
      return null;
    }

    const result = await commitFile(
      owner,
      repo,
      readmeFilePath,
      newContent,
      'docs: update organization readme badges',
      octokitClient
    );

    core.info('README updated successfully');
    return result;
  } catch (error) {
    core.error(`Failed to update README: ${error.message}`);
    throw error;
  }
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

export const generateBadges = async (
  orgParam,
  tokenParam,
  daysParam,
  graphqlClient,
  badgeColor,
  badgeLabelColor,
  badgePathParam,
  commitBadgesParam,
  readmePathParam,
  updateReadmeParam,
  octokitClient
) => {
  const org = orgParam || organization;
  const numDays = daysParam || days;
  const msgColor = badgeColor || color || 'blue';
  const lblColor = badgeLabelColor || labelColor || '555';
  const badgeDir = badgePathParam || badgePath || 'badges';
  const shouldCommitBadges = commitBadgesParam !== undefined ? commitBadgesParam : commitBadges;
  const readmeFile = readmePathParam || readmePath || 'profile/README.md';
  const shouldUpdateReadme = updateReadmeParam !== undefined ? updateReadmeParam : updateReadme;

  let client = graphqlClient || graphqlWithAuth;
  if (!client && tokenParam) {
    client = graphql.defaults({
      headers: {
        authorization: `token ${tokenParam}`
      },
      baseUrl: argv.graphqlUrl || 'https://api.github.com/graphql'
    });
  }

  let restClient = octokitClient || octokit;
  if (!restClient && tokenParam) {
    restClient = new Octokit({
      auth: tokenParam,
      baseUrl: (argv.graphqlUrl || 'https://api.github.com/graphql').replace('/graphql', '')
    });
  }

  try {
    // repo count
    const repos = await getRepositories(org, client);
    const repoCount = repos.length;
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

    core.info(`Total pull requests created in last ${numDays} days for ${org}: ${totalOpenPRs}`);
    core.info(`Total merged pull requests in last ${numDays} days for ${org}: ${totalMergedPRs}`);

    // Generate badge data
    const badgeData = [
      { name: 'Total repositories', value: repoCount },
      { name: `PRs created in last ${numDays} days`, value: totalOpenPRs },
      { name: `Merged PRs in last ${numDays} days`, value: totalMergedPRs }
    ];

    const badges = [];
    const badgeFiles = [];

    // Generate SVG badges and save them
    for (const { name, value } of badgeData) {
      const svg = generateBadgeSVG(name, value, msgColor, lblColor);
      const filepath = saveBadgeSVG(name, svg, badgeDir);
      badgeFiles.push(filepath);

      // Generate markdown reference to the SVG file
      const filename = path.basename(filepath);
      const badgeMarkdown = `![${name}](./${badgeDir}/${filename})`;
      badges.push(badgeMarkdown);
    }

    // Commit badges if requested
    if (shouldCommitBadges && restClient) {
      core.info('Committing badge files to repository...');

      // Extract owner and repo from organization or current repository
      const repoContext = process.env.GITHUB_REPOSITORY;
      if (!repoContext) {
        core.warning('GITHUB_REPOSITORY environment variable not set, skipping commit');
      } else {
        const [owner, repoName] = repoContext.split('/');

        for (const filepath of badgeFiles) {
          const fileContent = fs.readFileSync(filepath, 'utf8');
          const relativePath = filepath.replace(/^\.\//, '');
          await commitFile(
            owner,
            repoName,
            relativePath,
            fileContent,
            `chore: update ${path.basename(filepath)}`,
            restClient
          );
        }

        // Update README if requested
        if (shouldUpdateReadme) {
          core.info('Updating README with badge references...');
          const badgeReferences = badges.join(' ');
          await updateReadmeWithBadges(owner, repoName, readmeFile, badgeReferences, restClient);
        }
      }
    }

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
