# 🔨 Basha

#### Bash executor for executable documents

[![Build Status](https://dev.azure.com/stencila/stencila/_apis/build/status/stencila.basha?branchName=master)](https://dev.azure.com/stencila/stencila/_build/latest?definitionId=2&branchName=master)
[![Code coverage](https://codecov.io/gh/stencila/basha/branch/master/graph/badge.svg)](https://codecov.io/gh/stencila/basha)
[![NPM](https://img.shields.io/npm/v/@stencila/basha.svg?style=flat)](https://www.npmjs.com/package/@stencila/basha)
[![Docs](https://img.shields.io/badge/docs-latest-blue.svg)](https://stencila.github.io/basha/)

## 📦 Install

Basha is available as a Node.js package,

```bash
npm install @stencila/basha --global
```

In the future, Basha is likely to be bundled as part of the self contained [Stencila command line tool](https://github.com/stencila/stencila#cli).

Windows is [not yet supported](https://github.com/stencila/basha/issues/2).

## 🚀 Use

Register Basha so that it can be discovered by other executors on your machine,

```bash
basha register
```

If you have [`executa`](https://github.com/stencila/executa) installed globally, you can then run Basha using the `execute` command and specifying `bash` as the starting language,

```bash
executa execute --repl --lang bash
```

## 🛠️ Develop

You can test Basha manually using the local install of `executa` in this package. First, build and register the current version of Basha, so that Executa is able to find it,

```bash
npm run register
npx executa execute --repl --lang bash
```
