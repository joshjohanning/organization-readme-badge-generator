# organization-readme-badge-generator

[![GitHub release](https://img.shields.io/github/release/joshjohanning/organization-readme-badge-generator.svg?logo=github&labelColor=333)](https://github.com/joshjohanning/organization-readme-badge-generator/releases)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-github--organization--readme--badge--generator-blue?logo=github&labelColor=333)](https://github.com/marketplace/actions/github-organization-readme-badge-generator)
[![CI](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/publish.yml/badge.svg)](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/publish.yml)
![Coverage](./badges/coverage.svg)

An action to create SVG badge files for your GitHub organization's README.md file.

## What's New in v2

Version 2 introduces significant improvements:

- **Local SVG Badges**: Uses `badge-maker` to generate local SVG files instead of relying on shields.io URLs
- **Automated Commits**: Optionally commits badge files directly to your repository using the GitHub API (with verified commits)
- **Automated README Updates**: Optionally updates your README.md file with badge references automatically
- **No External Dependencies**: Badges are self-contained in your repository

> **Note**: v2 is a breaking change. Badge output format has changed from shields.io URLs to local SVG file references.

## Example

The action generates SVG badge files that can be committed to your repository and referenced in your README.

<!-- start organization badges -->

> # my-org-name
>
> ![Total repositories](./badges/total-repositories.svg) ![PRs created in last 30 days](./badges/prs-created-in-last-30-days.svg) ![Merged PRs in last 30 days](./badges/merged-prs-in-last-30-days.svg)

<!-- end organization badges -->

_Live example in my [`joshjohanning-org` org public README](https://github.com/joshjohanning-org#joshjohanning-org)_

## Usage

### V2 - Automated (Recommended)

With v2, the action can automatically commit badge files and update your README using the GitHub API for verified commits. This is the simplest approach:

```yml
name: update-organization-readme-badges

on:
  schedule:
    - cron: '0 7 * * *' # runs daily at 07:00
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate-badges:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v2
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ steps.app-token.outputs.token }}
          commit_badges: true
          update_readme: true
          readme_path: 'profile/README.md' # or 'README.md' for user/repo READMEs
```

### V2 - Manual Commit

If you prefer to handle commits yourself:

```yml
name: update-organization-readme-badges

on:
  schedule:
    - cron: '0 7 * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate-badges:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v2
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ steps.app-token.outputs.token }}
          badge_path: 'badges' # where to save SVG files

      # Badge files are created locally, commit them yourself
      - name: Commit badge files
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add badges/*.svg
          git commit -m "chore: update organization badges" || echo "No changes"
          git push
```

### Prerequisite (for automated README updates)

If using `update_readme: true`, add markers to your `profile/README.md` file where you want the badges to appear:

```md
# my-org-name

<!-- start organization badges -->

<!-- end organization badges -->
```

> **Note**: These markers are required for the automated README update feature in v2. If you're manually committing badges (v2 manual) or using v1, you can manage the badge placement yourself.

### V1 - Legacy (shields.io URLs)

The v1 approach using shields.io URLs and bash script for updates:

```yml
name: update-organization-readme-badges

on:
  schedule:
    - cron: '0 7 * * *' # runs daily at 07:00
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate-badges:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: organization-readme-badge-generator
        id: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v1
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ steps.app-token.outputs.token }} # recommend to use a GitHub App and not a PAT
          color: blue # optional, default is blue
          label_color: '555' # optional, default is 555
          days: 30 # optional, default is 30

      - name: write to job summary
        run: |
          echo "${{ steps.organization-readme-badge-generator.outputs.badges }}" >> $GITHUB_STEP_SUMMARY

      - name: add to readme
        run: |
          readme=profile/README.md

          # get SHA256 before
          beforeHash=$(sha256sum $readme | awk '{ print $1 }')

          # Define start and end markers
          startMarker="<!-- start organization badges -->"
          endMarker="<!-- end organization badges -->"

          replacement="${{ steps.organization-readme-badge-generator.outputs.badges }}"

          # Escape special characters in the replacement text
          replacementEscaped=$(printf '%s\n' "$replacement" | perl -pe 's/([\\\/\$\(\)@])/\\$1/g')

          # Use perl to replace the text between the markers
          perl -i -pe "BEGIN{undef $/;} s/\Q$startMarker\E.*?\Q$endMarker\E/$startMarker\n$replacementEscaped\n$endMarker/smg" $readme
          # get SHA256 after
          afterHash=$(sha256sum $readme | awk '{ print $1 }')
          # Compare the hashes and commit if required
          if [ "$afterHash" = "$beforeHash" ]; then
            echo "The hashes are equal - exiting script"
            exit 0
          else
            git config --global user.name 'github-actions[bot]'
            git config --global user.email 'github-actions[bot]@users.noreply.github.com'
            git add $readme
            git commit -m "docs: update organization readme badges"
            git push
          fi
```

## Inputs

| Input           | Description                                                                                                   | Required | Default                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------- |
| `organization`  | The GitHub organization to query                                                                              | Yes      | `${{ github.repository_owner }}` |
| `token`         | PAT or GitHub App token to query the GitHub API                                                               | Yes      | `${{ github.token }}`            |
| `days`          | Number of days to look back for pull request statistics                                                       | No       | `30`                             |
| `color`         | Badge color for the message (right side). Supports named colors (blue, green, red, etc.) or hex colors        | No       | `blue`                           |
| `label_color`   | Badge color for the label (left side). Supports named colors or hex colors (quote hex values)                 | No       | `555`                            |
| `graphql_url`   | The URL to the GitHub GraphQL API endpoint (for GitHub Enterprise)                                            | No       | `https://api.github.com/graphql` |
| `badge_path`    | The path where badge SVG files should be saved (relative to repository root)                                  | No       | `badges`                         |
| `commit_badges` | Whether to commit badge files to the repository using GitHub API (verified commits). Set to `true` to enable. | No       | `false`                          |
| `readme_path`   | The path to the README file to update (relative to repository root). Only used if `update_readme` is `true`.  | No       | `profile/README.md`              |
| `update_readme` | Whether to update the README file with badge references between markers (requires commit_badges to be true)   | No       | `false`                          |

## Outputs

| Output   | Description                                                                     |
| -------- | ------------------------------------------------------------------------------- |
| `badges` | The badge markdown referencing local SVG files (e.g., `![...](./badges/*.svg)`) |

## Color Options

The `color` and `label_color` parameters support:

- **Named colors**: `brightgreen`, `green`, `yellowgreen`, `yellow`, `orange`, `red`, `blue`, `lightgrey`, etc.
- **Hex colors**: Use quotes for hex values, e.g., `'333'`, `'ff69b4'`, `'007ec6'`
- **RGB colors**: e.g., `'rgb(255,0,0)'`

Examples:

```yaml
color: blue
label_color: '333' # dark gray
```

```yaml
color: brightgreen
label_color: '555' # medium gray
```
