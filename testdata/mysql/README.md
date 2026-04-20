# Local MySQL Test Assets

这个目录提供当前 `@huaweicloud/taurusdb-mcp` 本地联调所需的测试资产：

- `local-mysql-schema.sql`: 重建 `taurus_mcp_test` 测试库和表结构
- `local-mysql-seed.sql`: 写入联调用样例数据
- `local-mysql-profiles.example.json`: 本地 datasource profile 示例

推荐使用顺序：

```bash
mysql -uroot -p < testdata/mysql/local-mysql-schema.sql
mysql -uroot -p < testdata/mysql/local-mysql-seed.sql
```

如果需要运行自动化本地 MySQL 集成测试，请至少准备这些环境变量：

```bash
export TAURUSDB_RUN_LOCAL_MYSQL_TESTS=true
export TAURUSDB_TEST_MYSQL_HOST=127.0.0.1
export TAURUSDB_TEST_MYSQL_PORT=3306
export TAURUSDB_TEST_MYSQL_DATABASE=taurus_mcp_test
export TAURUSDB_TEST_MYSQL_USER=taurus_ro
export TAURUSDB_TEST_MYSQL_PASSWORD=your_password
```

如需测试 mutation 和自动重建测试库，再补充：

```bash
export TAURUSDB_TEST_MYSQL_MUTATION_USER=taurus_rw
export TAURUSDB_TEST_MYSQL_MUTATION_PASSWORD=your_password
export TAURUSDB_TEST_MYSQL_BOOTSTRAP_DSN='mysql://root:root@127.0.0.1:3306/mysql'
```
