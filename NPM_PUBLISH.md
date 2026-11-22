# AgentCorp 包安装（GitHub Packages）

AgentCorp 发布在 **GitHub Packages**（npm registry：`https://npm.pkg.github.com`），包名为 `@postskt/agentcorp`。

> ⚠️ 由于 npmjs.org 访问受限，且 `agentcorp` 名字在 npmjs 已被无关包占用，改用 GitHub Packages。
> **重要限制**：GitHub Packages 的 npm 包即使设为 public，安装时也需要一个 GitHub token 认证（不像 npmjs 那样免登录）。下面会说明如何配置。

## 别人怎么装

### 1. 生成 GitHub token（一次性）

在 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) 生成一个 token，勾选 **`read:packages`** 权限。

### 2. 配置 `.npmrc`（在你要安装 AgentCorp 的项目目录）

```ini
@postskt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=你的GitHub_TOKEN
```

或在终端登录（用户名填 GitHub 用户名，密码填上面的 token）：

```bash
npm login --scope=@postskt --auth-type=legacy --registry=https://npm.pkg.github.com
```

### 3. 安装

```bash
npm install -g @postskt/agentcorp
# 或按需：npx -y @postskt/agentcorp mcp
```

作为 MCP server 的配置：

```json
{ "mcpServers": { "agentcorp": {
  "command": "npx",
  "args": ["-y", "@postskt/agentcorp", "mcp"],
  "env": { "AGENTCORP_WORKSPACE": "E:/agent-link" }
} } }
```

## 维护者怎么发布

发布由 GitHub Actions 自动完成，**不需要本地 token、不需要访问 npmjs.org**：

- 工作流：`.github/workflows/publish.yml`
- 触发：推送 `v*` 标签（如 `git tag v0.2.1 && git push origin v0.2.1`），或在 Actions 页手动点 "Run workflow"
- 权限：工作流用内置 `GITHUB_TOKEN`（带 `packages: write`），发布后自动把包设为 public
- 发布时 CI 里临时把包名改为 `@postskt/agentcorp`（仓库里始终保持 `agentcorp`，以兼容 DSH 的 `cordis.patch.yml`）

本地也保留了手动发布脚本 `npm-publish-github.mjs`，但它需要带 `write:packages` 权限的 classic PAT（通过 `GITHUB_TOKEN` 环境变量传入），一般不用，交给 Actions 即可。

## 为什么包名是 `@postskt/agentcorp`

- GitHub Packages 强制要求 scoped 包名（`@owner/name`）。
- 仓库和 DSH 插件仍叫 `agentcorp`（DSH 靠它匹配 `cordis.patch.yml`，`dsh plugin add github:postskt/agentcorp` 是 DSH 自己的语法，有效且与 npm 无关）。
- 不要用 `npm install github:postskt/agentcorp` —— `github:` 简写在很多环境会报"格式错误"。
