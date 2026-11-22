# AgentCorp npm 安装与发布

## 用户怎么装（唯一推荐方式）

```bash
npm install -g postskt-agentcorp
# 或按需调用，不全局安装：
npx -y postskt-agentcorp mcp
```

这是发布在 npmjs.org 上的**标准包名**，任何支持 npm 的环境都能安装。作为 MCP server 写进各家配置：

```json
{
  "mcpServers": {
    "agentcorp": {
      "command": "npx",
      "args": ["-y", "postskt-agentcorp", "mcp"],
      "env": { "AGENTCORP_WORKSPACE": "E:/agent-link" }
    }
  }
}
```

> ⚠️ **不要用 `npm install -g github:postskt/agentcorp`**。`github:` 简写在很多环境（旧版 npm、部分工具、受限网络/代理）会报"格式错误"或拉不下来。请始终用标准包名 `postskt-agentcorp`。

## 维护者怎么发布到 npmjs.org

### 为什么不是直接 `npm publish`

- npm 上无 scope 的 `agentcorp` 已被一个无关包占用（描述是 "hello world"），无法使用。
- 仓库的 `package.json` 名字**必须保持 `agentcorp`**：DSH 的 `cordis.patch.yml` 靠插件行名匹配包名，`dsh plugin add github:postskt/agentcorp` 依赖这一点（这是 DSH 自己的插件语法，与 npm 无关，是有效的）。直接改名会破坏 DSH 原生插件安装。
- 所以发布脚本 `npm-publish.mjs` 采用「临时改名 → 发布 → 恢复」：发布时用 `postskt-agentcorp`，结束后自动把 `package.json` 恢复成 `agentcorp`。

### 发布步骤

```bash
npm login                       # 首次需要，浏览器/终端登录 npmjs 账号
node npm-publish.mjs --dry-run  # 预演，确认打包文件与名字
node npm-publish.mjs            # 正式发布 postskt-agentcorp@<version>
```

脚本行为：
1. 检查 `npm whoami`，未登录直接报错退出（不会改文件）。
2. 临时把 `package.json` 的 `name` 改为 `postskt-agentcorp`，加 `publishConfig.access=public`。
3. 执行 `npm publish --access public`。
4. 在 `finally` 中恢复原始 `package.json`，无论成功失败都不会留下改名。

自定义包名：

```bash
NPM_PKG_NAME=@yourname/agentcorp node npm-publish.mjs   # 用你自己的 scope
```

> 注意：包名和版本一旦发布到 npm 就永久占用、同名同版本不能重发。每次发布前记得在 `package.json` 里递增 `version`。脚本恢复的是原始版本，所以版本号由你手动维护。

### 发布后验证

```bash
npm view postskt-agentcorp version
npm pack postskt-agentcorp          # 确认能从 registry 拉到
npx -y postskt-agentcorp mcp        # 确认 stdio MCP server 能启动
```

## `mcp` 子命令

包最终靠 CLI 的 `mcp` 子命令启动 stdio MCP server：

```bash
agentcorp mcp     # = node src/index.js，供 npx 作为 MCP server 调用
```
