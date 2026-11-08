# GitHub setup

The optional bootstrap helper targets `verdictan/screens` and a GitHub Project
named `screens`. It uses the authenticated GitHub CLI:

```sh
node scripts/bootstrap-github.mjs
```

It finds or creates the repository/project, creates missing issues from
`project-backlog.json`, and adds them to the board. Reruns reuse existing records.
Creation requires repository and Projects write access. The helper does not
publish code, grant access, or change credential permissions.

The JSON file is a bootstrap issue template. Use the [Roadmap](roadmap.md) for
current implementation and remaining release evidence.
