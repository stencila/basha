all: lint format cover build docs

setup:
	npm install

lint:
	npm run lint

format:
	npm run format

test:
	npm test

cover:
	npm run test:cover

build:
	npm run build

docs:
	npm run docs
.PHONY: docs
