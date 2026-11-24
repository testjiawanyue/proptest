# 环境指纹与运行态复验

- 环境编号：`ENV-2026-11-23-01`
- 环境指纹：`22b04e2e67dbabd47ef7e121f033d15f3ba16315ddb9d185fa86cd49b18115ce`
- 采集时间：`2026-11-23T15:43:59+08:00`
- 状态：`captured`
- 明文账号、密码、Token、API Key 和 JDBC 凭据未写入。

## 1. 结论

- 核心端口检查：通过。
- 后端实际 JVM：`java version "17.0.2" 2022-01-18 LTS`。
- 项目声明 Java：`17`。
- 数据库结构摘要：`c51a3f1d65fcce05d5762d393b7e0bb5b2e95150a2962941988fcd56eb7b4ead`。
- 数据库表数：`84`。

## 2. 主机与工具链

| 项目 | 值 |
|---|---|
| 主机名 | `DESKTOP-LVCFINU` |
| 操作系统 | Windows 11 |
| CPU 逻辑核数 | 16 |
| 主机时区 | `中国标准时间` |
| PATH 中 Java | `openjdk version "21.0.12.1" 2026-08-18 LTS` |
| 后端进程 Java | `java version "17.0.2" 2022-01-18 LTS` |
| Maven | `Apache Maven 3.9.6 (bc0240f3c744dd6b6ec2920b3cd08dcc295161ae)` |
| Node.js | `v24.13.0` |
| npm | `11.6.2` |
| Playwright | `1.64.1` |
| Chromium | 存在 |

## 3. 拓扑与端口

| 目标 | 地址 | 必需 | 状态 |
|---|---|---|---|
| frontend | `127.0.0.1:8090` | 是 | 可达 |
| backend | `127.0.0.1:8080` | 是 | 可达 |
| mysql | `127.0.0.1:13306` | 是 | 可达 |
| redis | `127.0.0.1:16379` | 是 | 可达 |
| viteDefaultUnused | `127.0.0.1:3000` | 否 | 不可达 |

> 前端实际端口来自 `ruoyi-ui/env/.env.dev` 的 `VITE_PORT=8090`；Vite 默认 3000 不是当前运行入口。

## 4. 运行态检查

| 检查 | 地址或对象 | 结果 |
|---|---|---|
| frontendLogin | `http://127.0.0.1:8090/` | HTTP 200 |
| backendRoot | `http://127.0.0.1:8080/` | HTTP 200 |
| backendHealthEnvelope | `http://127.0.0.1:8080/actuator/health` | HTTP 200 |
| backendRedisCaptcha | `http://127.0.0.1:8080/captchaImage` | HTTP 200 |
| MySQL | `127.0.0.1:13306` | 已连接，版本 5.7.36 |
| 应用连接时区 | JDBC 参数 | `%2B09:00` |
| 容器 prop-dev2-local-mysql | `mysql:5.7.36` | running/healthy |
| 容器 prop-dev2-local-redis | `redis:7.4-alpine` | running/healthy |

## 5. 数据库基线

| 项目 | 值 |
|---|---|
| database | `prop_dev_local` |
| serverVersion | `5.7.36` |
| characterSetServer | `utf8mb4` |
| collationServer | `utf8mb4_general_ci` |
| globalTimeZone | `SYSTEM` |
| sessionTimeZone | `SYSTEM` |
| serverNow | `2026-11-23 07:44:09` |
| prop_order 行数 | 8 |
| prop_order_line 行数 | 9 |
| prop_shipment 行数 | 11 |
| prop_shipment_product 行数 | 11 |

## 6. 配置与容器指纹

| 对象 | SHA256 或摘要 |
|---|---|
| applicationYml | `bc17ff2c0689e5bf425f78b210b8eaa36256234414272b2929f0574ae33971bb` |
| applicationDruidYml | `19d1020c297c6ab9d6ffcde415f362f90e3c07ae25bc9283630eb122f7a26076` |
| localApplicationOverride | `3046c35fa2ef8840f1268efd4fe8baa85c8a402c3ee719d2bd2f5b02b5dad77f` |
| composeLocal | `90ed0899ec474175ea86695554bd5fbdbe570a333c2a6a56a6b1e21f185198fe` |
| frontendDevEnv | `a7c5722a766efbee351716fb30e8dc580e36ba24613d0388b07c24e1dfadc036` |
| viteBase | `7ebed6acf8e7c7a9cf87cae927b355f7ed453f5674476c024f41997a43a6f7eb` |
| frontendPackageLock | `5840fb5b1490cb1558620981c4c963777dcabe2c9aaf2e53a9ebeb3d7ad3a12e` |
| autoExplorePackageLock | `580fce106bd60e13974886553fae7cc3658f78150acfac475063c446a47c34e4` |
| autoExploreEnv | `c58865b5fecb378590877bc0f5be1c6ccdea67237aeb3c8b2c38257a6ffce873` |
| prop-dev2-local-mysql 镜像 | `mysql@sha256:f2ad209efe9c67104167fc609cca6973c8422939491c9345270175a300419f94` |
| prop-dev2-local-redis 镜像 | `redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499` |

## 7. 阻断项与残余风险

- 无运行态阻断项。
- 残余风险：auto-explore 未配置 APP_ENV_FINGERPRINT，当前防误连主要依赖 local/private 主机限制和人工复核
- 残余风险：prop_new 工作区存在既有未提交改动，环境指纹绑定到当前提交但不代表工作树干净

## 8. 标准启动顺序

1. `docker compose -f compose.local.yaml start mysql redis`
2. 确认 MySQL 13306 与 Redis 16379 健康。
3. 以 JDK 17、`-Duser.timezone=Asia/Tokyo`、`druid,local` 启动后端，等待 8080 健康。
4. 在 `ruoyi-ui` 执行 `npm run dev`，确认前端 8090 与 `/dev-api` 代理可用。
5. 执行本采集脚本，确认状态为 `captured` 且阻断项为空。

## 9. 复现方式

运行 `E:\proptest\systemquality\tools\capture_w1_baseline.py`。脚本只读取配置、版本、端口、HTTP、数据库结构和容器健康状态；不执行测试、不写业务数据。
