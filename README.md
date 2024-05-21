# organization-readme-badge-generator

An action to create markdown badges for your GitHub organization's README.md file

## Usage

```yaml
steps:
  - name: organization-readme-badge-generator
    id: organization-readme-badge-generator
    uses: joshjohanning/organization-readme-badge-generator@v1
    with:
      organization: ${{ github.repository_owner }}
      token: ${{ secrets.ADMIN_TOKEN }} # recommend to use a GitHub App and not a PAT

  - name: write to job summary
    run: |
      cat ${{ steps.organization-readme-badge-generator.outputs.badges }} >> $GITHUB_STEP_SUMMARY
      # TODO: write to profile/README.md for .github / .github-private repo
```

## Example

TODO: add screenshot or markdown example
