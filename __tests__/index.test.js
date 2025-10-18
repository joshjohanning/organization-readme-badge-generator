import { jest } from '@jest/globals';
import core from '@actions/core';
import {
  generateBadgeMarkdown,
  generateBadgeSVG,
  sanitizeFilename,
  saveBadgeSVG,
  getFileContent,
  commitFile,
  updateReadmeWithBadges,
  getRepositoryCount,
  getRepositories,
  getPullRequestsCount,
  generateBadges,
  validateRequiredInput
} from '../src/index.js';
import fs from 'fs';

// Mock @actions/core
jest.spyOn(core, 'info').mockImplementation(() => {});
jest.spyOn(core, 'debug').mockImplementation(() => {});
jest.spyOn(core, 'error').mockImplementation(() => {});
jest.spyOn(core, 'setOutput').mockImplementation(() => {});

describe('generateBadgeMarkdown', () => {
  it('should generate correct markdown badge with shields.io URL', () => {
    const result = generateBadgeMarkdown('Test Label', 42, 'blue', '555');
    expect(result).toBe('![Test Label](https://img.shields.io/badge/Test%20Label-42-blue?labelColor=555)');
  });

  it('should handle special characters in label', () => {
    const result = generateBadgeMarkdown('Test & Label', 10, 'green', '555');
    expect(result).toBe('![Test & Label](https://img.shields.io/badge/Test%20%26%20Label-10-green?labelColor=555)');
  });

  it('should handle numeric message', () => {
    const result = generateBadgeMarkdown('Count', 0, 'red', '555');
    expect(result).toBe('![Count](https://img.shields.io/badge/Count-0-red?labelColor=555)');
  });

  it('should use custom label color', () => {
    const result = generateBadgeMarkdown('Custom', 5, 'blue', 'red');
    expect(result).toBe('![Custom](https://img.shields.io/badge/Custom-5-blue?labelColor=red)');
  });
});

describe('getRepositoryCount', () => {
  it('should return total repository count', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          totalCount: 42
        }
      }
    });

    const count = await getRepositoryCount('test-org', mockGraphqlClient);

    expect(count).toBe(42);
    expect(mockGraphqlClient).toHaveBeenCalledWith(expect.stringContaining('query ($organization: String!)'), {
      organization: 'test-org'
    });
  });

  it('should handle organization with zero repositories', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          totalCount: 0
        }
      }
    });

    const count = await getRepositoryCount('empty-org', mockGraphqlClient);
    expect(count).toBe(0);
  });

  it('should throw error when graphql fails', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('GraphQL Error'));

    await expect(getRepositoryCount('test-org', mockGraphqlClient)).rejects.toThrow('GraphQL Error');
  });
});

describe('getRepositories', () => {
  it('should return all repository names with pagination', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }, { name: 'repo2' }],
            pageInfo: {
              endCursor: 'cursor1',
              hasNextPage: true
            }
          }
        }
      })
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo3' }],
            pageInfo: {
              endCursor: 'cursor2',
              hasNextPage: false
            }
          }
        }
      });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual(['repo1', 'repo2', 'repo3']);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
  });

  it('should handle single page response', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          nodes: [{ name: 'single-repo' }],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual(['single-repo']);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(1);
  });

  it('should handle empty repository list', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          nodes: [],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual([]);
  });
});

describe('getPullRequestsCount', () => {
  const filterDate = '2024-01-01';

  it('should count open and merged PRs after filter date', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [
            {
              createdAt: '2024-01-15T10:00:00Z',
              mergedAt: '2024-01-20T10:00:00Z',
              state: 'MERGED'
            },
            {
              createdAt: '2024-01-10T10:00:00Z',
              mergedAt: null,
              state: 'OPEN'
            },
            {
              createdAt: '2023-12-15T10:00:00Z',
              mergedAt: null,
              state: 'OPEN'
            }
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(2); // 2 PRs created after 2024-01-01
    expect(result.merged).toBe(1); // 1 PR merged after 2024-01-01
  });

  it('should handle pagination for pull requests', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: {
              endCursor: 'cursor1',
              hasNextPage: true
            }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(2);
    expect(result.merged).toBe(1);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
  });

  it('should return zero counts when no PRs match filter', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [
            {
              createdAt: '2023-01-15T10:00:00Z',
              mergedAt: '2023-01-20T10:00:00Z',
              state: 'MERGED'
            }
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
  });

  it('should handle repository with no pull requests', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
  });
});

describe('generateBadges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate all badges for an organization', async () => {
    const mockGraphqlClient = jest
      .fn()
      // getRepositories call
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }, { name: 'repo2' }],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      })
      // getPullRequestsCount for repo1
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      })
      // getPullRequestsCount for repo2
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const badges = await generateBadges('test-org', 'token', 30, mockGraphqlClient, 'blue', '555');

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('Total repositories');
    expect(badges[0]).toContain('./badges/');
    expect(badges[0]).toContain('.svg');
    expect(badges[1]).toContain('PRs created in last 30 days');
    expect(badges[2]).toContain('Merged PRs in last 30 days');
    expect(core.info).toHaveBeenCalledWith('Total repositories: 2');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Total pull requests created'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Total merged pull requests'));
  });

  it('should handle organization with no repositories', async () => {
    const mockGraphqlClient = jest
      .fn()
      // getRepositories call
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const badges = await generateBadges('empty-org', 'token', 30, mockGraphqlClient, 'blue', '555');

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('./badges/');
    expect(badges[0]).toContain('.svg');
    expect(badges[1]).toContain('PRs created in last 30 days');
    expect(badges[1]).toContain('./badges/');
    expect(badges[1]).toContain('.svg');
  });

  it('should handle errors in generateBadges', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('GraphQL API Error'));

    // Mock process.exit to prevent test from exiting
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(generateBadges('test-org', 'token', 30, mockGraphqlClient, 'blue', '555')).rejects.toThrow(
      'process.exit called'
    );

    expect(core.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it('should use default colors when not provided', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const badges = await generateBadges('test-org', 'token', 30, mockGraphqlClient);

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('./badges/');
    expect(badges[0]).toContain('.svg');
  });
});

describe('validateRequiredInput', () => {
  it('should return value when input is provided', () => {
    const result = validateRequiredInput('test-org', 'organization');
    expect(result).toBe('test-org');
  });

  it('should throw error when input is missing', () => {
    expect(() => validateRequiredInput('', 'organization')).toThrow('organization is required');
  });

  it('should throw error when input is null', () => {
    expect(() => validateRequiredInput(null, 'token')).toThrow('token is required');
  });

  it('should throw error when input is undefined', () => {
    expect(() => validateRequiredInput(undefined, 'days')).toThrow('days is required');
  });
});

describe('generateBadgeSVG', () => {
  it('should generate SVG badge', () => {
    const result = generateBadgeSVG('Test Label', 42, 'blue', '555');
    expect(result).toContain('<svg');
    expect(result).toContain('Test Label');
    expect(result).toContain('42');
  });

  it('should handle numeric values', () => {
    const result = generateBadgeSVG('Count', 0, 'red', '555');
    expect(result).toContain('<svg');
    expect(result).toContain('Count');
    expect(result).toContain('0');
  });
});

describe('sanitizeFilename', () => {
  it('should sanitize filename with special characters', () => {
    const result = sanitizeFilename('Test: Label/Name');
    expect(result).toBe('test--label-name');
  });

  it('should replace spaces with dashes', () => {
    const result = sanitizeFilename('Total repositories');
    expect(result).toBe('total-repositories');
  });

  it('should convert to lowercase', () => {
    const result = sanitizeFilename('MyFile');
    expect(result).toBe('myfile');
  });
});

describe('saveBadgeSVG', () => {
  const testDir = '/tmp/test-badges';

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should create directory and save SVG file', () => {
    const svgContent = '<svg>test</svg>';
    const filepath = saveBadgeSVG('Test Badge', svgContent, testDir);

    expect(filepath).toContain('test-badge.svg');
    expect(fs.existsSync(filepath)).toBe(true);
    expect(fs.readFileSync(filepath, 'utf8')).toBe(svgContent);
  });

  it('should handle existing directory', () => {
    fs.mkdirSync(testDir, { recursive: true });

    const svgContent = '<svg>test2</svg>';
    const filepath = saveBadgeSVG('Another Badge', svgContent, testDir);

    expect(fs.existsSync(filepath)).toBe(true);
    expect(fs.readFileSync(filepath, 'utf8')).toBe(svgContent);
  });
});

describe('getFileContent', () => {
  it('should get file content from repository', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from('test content').toString('base64'),
            sha: 'abc123'
          }
        })
      }
    };

    const result = await getFileContent('owner', 'repo', 'README.md', mockOctokit);

    expect(result).toEqual({
      content: 'test content',
      sha: 'abc123'
    });
    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      path: 'README.md'
    });
  });

  it('should return null when file is not found', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 404 })
      }
    };

    const result = await getFileContent('owner', 'repo', 'missing.md', mockOctokit);

    expect(result).toBeNull();
  });

  it('should throw error for other errors', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 500, message: 'Server error' })
      }
    };

    await expect(getFileContent('owner', 'repo', 'file.md', mockOctokit)).rejects.toEqual({
      status: 500,
      message: 'Server error'
    });
  });
});

describe('commitFile', () => {
  it('should create new file when it does not exist', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents: jest.fn().mockResolvedValue({
          data: { commit: { sha: 'new123' } }
        })
      }
    };

    const result = await commitFile('owner', 'repo', 'new.txt', 'content', 'Add new file', mockOctokit);

    expect(result.commit.sha).toBe('new123');
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      path: 'new.txt',
      message: 'Add new file',
      content: Buffer.from('content').toString('base64')
    });
  });

  it('should update existing file with SHA', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from('old content').toString('base64'),
            sha: 'old123'
          }
        }),
        createOrUpdateFileContents: jest.fn().mockResolvedValue({
          data: { commit: { sha: 'updated123' } }
        })
      }
    };

    const result = await commitFile('owner', 'repo', 'existing.txt', 'new content', 'Update file', mockOctokit);

    expect(result.commit.sha).toBe('updated123');
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      path: 'existing.txt',
      message: 'Update file',
      content: Buffer.from('new content').toString('base64'),
      sha: 'old123'
    });
  });
});

describe('updateReadmeWithBadges', () => {
  it('should update README between markers', async () => {
    const originalContent =
      '# Title\n<!-- start organization badges -->\nold badges\n<!-- end organization badges -->\nMore content';
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from(originalContent).toString('base64'),
            sha: 'readme123'
          }
        }),
        createOrUpdateFileContents: jest.fn().mockResolvedValue({
          data: { commit: { sha: 'updated456' } }
        })
      }
    };

    const result = await updateReadmeWithBadges('owner', 'repo', 'README.md', 'new badge content', mockOctokit);

    expect(result.commit.sha).toBe('updated456');
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalled();

    const call = mockOctokit.repos.createOrUpdateFileContents.mock.calls[0][0];
    const updatedContent = Buffer.from(call.content, 'base64').toString('utf8');

    expect(updatedContent).toContain('<!-- start organization badges -->');
    expect(updatedContent).toContain('new badge content');
    expect(updatedContent).toContain('<!-- end organization badges -->');
    expect(updatedContent).not.toContain('old badges');
  });

  it('should return null when README is not found', async () => {
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockRejectedValue({ status: 404 })
      }
    };

    const result = await updateReadmeWithBadges('owner', 'repo', 'README.md', 'badges', mockOctokit);

    expect(result).toBeNull();
  });

  it('should return null when markers are not found', async () => {
    const originalContent = '# Title\nNo markers here';
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from(originalContent).toString('base64'),
            sha: 'readme123'
          }
        })
      }
    };

    const result = await updateReadmeWithBadges('owner', 'repo', 'README.md', 'badges', mockOctokit);

    expect(result).toBeNull();
  });

  it('should return null when content is unchanged', async () => {
    const badgeContent = 'badge content';
    const originalContent = `# Title\n<!-- start organization badges -->\n${badgeContent}\n<!-- end organization badges -->\nMore content`;
    const mockOctokit = {
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: {
            content: Buffer.from(originalContent).toString('base64'),
            sha: 'readme123'
          }
        })
      }
    };

    const result = await updateReadmeWithBadges('owner', 'repo', 'README.md', badgeContent, mockOctokit);

    expect(result).toBeNull();
  });
});
