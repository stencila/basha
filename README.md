# 🔨 Basha

#### Bash interpreter for Stencila

[![Build status](https://dev.azure.com/stencila/stencila/_apis/build/status/stencila.basha?branchName=master)](https://dev.azure.com/stencila/stencila/_build/latest?definitionId=1&branchName=master)
[![Code coverage](https://codecov.io/gh/stencila/basha/branch/master/graph/badge.svg)](https://codecov.io/gh/stencila/basha)
[![NPM](https://img.shields.io/npm/v/@stencila/basha.svg?style=flat)](https://www.npmjs.com/package/@stencila/basha)
[![Docs](https://img.shields.io/badge/docs-latest-blue.svg)](https://stencila.github.io/basha/)

## Install

Basha is available as a Node.js package,

```bash
npm install --global @stencila/basha
```

In the future, Basha will be bundled as part of the self contained [Stencila command line tool](https://github.com/stencila/stencila#cli).

## Use

If you have [`executa`](https://github.com/stencila/executa) installed globally then you can run it using the `repl` command and specifying `bash` as the starting language,

```bash
executa repl bash
```

## Develop

You can test Basha manually using the local install of `executa` in this package,

```bash
npx executa repl bash
```
