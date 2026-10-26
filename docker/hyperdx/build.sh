#!/bin/bash
# Meant to be run from the root of the repo

# No Auth
container build . -f ./docker/hyperdx/Dockerfile \
    --target all-in-one-noauth -t hyperdx/dev-all-in-one-noauth
