# AWS Auth Helper

A cli to replace the `aws-profile` function in `~/.zshrc` that:

1. Reads available accounts from the `~/.aws/credentials` file and lets you select one from a list.
2. Replicates the rest of the functionality of the original `aws-profile` function, including showing the current profile and unsetting it, with better help documentation.
3. Written in bun
