# Useful Deno scripts

These are some scripts that can be run for various maintenance tasks and audit tasks. Their purpose is to make running simple and repeatable tasks easily without the need to clone or download them using [Deno](https://deno.land/)


## Running a script

To run any of the scripts in this repo you will need to install deno in the system you want to run the scripts and make sure that they have access to this repo.

```sh
deno run -A -r https://raw.githubusercontent.com/ashwin-pc/Useful-Deno-Scripts/main/github/missing_backports.ts --auth=ghp_gpbx1VhiQldEuIqBCxTaJY444kjk5H01V5Ri1
```

> The auth token here is not a valid one, use your own [auth token](https://github.com/settings/tokens)

All scripts that that use the github api need the `--auth` flag with a valid github auth token to work.