# Minimal JupyterHub single-user image with jupyter-geoagent and
# jupyter-ai (Claude + OpenCode ACP personas) pre-installed.
#
# Base: quay.io/jupyter/minimal-notebook — Ubuntu-based Jupyter Server
# with Python, JupyterLab 4, git/curl/bash utilities, NB_USER=jovyan,
# NB_UID=1000. Intended for JupyterHub single-user pods.
FROM quay.io/jupyter/minimal-notebook:latest

USER root

# Node.js (with bundled npm) is required for the
# @zed-industries/claude-agent-acp bridge that jupyter-ai spawns when
# the user @mentions @Claude. Ubuntu 24.04's apt ships Node 18, but the
# ACP bridge uses ESM import attributes (`with { type: "json" }`) which
# require Node >= 20. Pull Node 22 LTS from NodeSource instead.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI. The installer drops a versioned binary tree under
# $HOME/.local/share/claude/versions/<ver>/ and a symlink at
# $HOME/.local/bin/claude pointing to it. For a system-wide install
# that survives JupyterHub home-volume mounts, move the whole tree to
# /opt/claude and retarget the /usr/local/bin/claude symlink.
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    CLAUDE_TARGET="$(readlink "$HOME/.local/bin/claude")" && \
    mv "$HOME/.local/share/claude" /opt/claude && \
    ln -sf "${CLAUDE_TARGET/$HOME\/.local\/share\/claude/\/opt\/claude}" /usr/local/bin/claude && \
    rm -rf "$HOME/.local"

# OpenCode CLI — used by the jupyter-ai OpenCode persona.
ENV OPENCODE_VERSION=1.18.20
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION}" && \
    mv "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode && \
    rm -rf "$HOME/.opencode"

# Claude ACP bridge — installs a `claude-agent-acp` binary onto PATH.
RUN npm install -g @zed-industries/claude-agent-acp && \
    npm cache clean --force

# Typst for PDF rendering (for Fernando's talk 2026-04-29)
RUN mamba install typst

# jupyter-ai v3 transitively pulls jupyter-ai-acp-client,
# jupyter-ai-chat-commands, and jupyter-ai-persona-manager, which
# register the Claude / OpenCode / Goose personas automatically.
# jupyter-geoagent registers the GeoAgent Map launcher tile plus
# `geoagent:*` JupyterLab commands so the LLM personas can drive the
# map directly from chat.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Geoagent system prompt for the AI personas. AGENTS.md is the source of
# truth (read by Claude Code, OpenCode, Codex, Cursor, etc.); CLAUDE.md is
# a one-liner `@AGENTS.md` include for older Claude Code versions. Both
# are baked into the image at a non-mounted system path; a
# `before-notebook.d` hook copies them into $HOME on container start
# (only when not already present). $HOME is overlaid by the JupyterHub PVC
# mount at runtime, so the files can't be baked there directly.
COPY AGENTS.md CLAUDE.md /usr/local/share/jupyter-geoagent/
COPY install-agent-md.sh /usr/local/bin/before-notebook.d/00-install-agent-md.sh
RUN chmod +x /usr/local/bin/before-notebook.d/00-install-agent-md.sh

# Enable GitHub Scoped Creds usage on CryoCloud
# https://github.com/jupyterhub/gh-scoped-creds
# TODO: Make this image hub-agnostic!
ENV GH_SCOPED_CREDS_CLIENT_ID="Iv1.bd27058fd393e285"
ENV GH_SCOPED_CREDS_APP_URL="https://github.com/apps/cryocloud-github-access"

USER ${NB_UID}
