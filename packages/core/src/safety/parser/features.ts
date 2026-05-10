import type { AstNode, GroupByNode, JoinNode, LimitNode, OrderByNode, WhereNode } from "./types.js";
import { getFunctionName, isObject, toLimitNode, toWhereNode } from "./ast-utils.js";

const AGGREGATE_FUNCTIONS = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "GROUP_CONCAT",
  "STRING_AGG",
  "JSON_AGG",
  "ARRAY_AGG",
]);

export function scanAst(statements: AstNode[]): { hasAggregate: boolean; hasSubquery: boolean } {
  let hasAggregate = false;
  let hasSubquery = false;

  const visit = (
    node: unknown,
    isTopLevelStatement: boolean,
    parentType?: string,
    parentKey?: string,
  ): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, false, parentType, parentKey);
      }
      return;
    }
    if (!isObject(node)) {
      return;
    }

    const nodeType = typeof node.type === "string" ? node.type.toLowerCase() : undefined;
    if (nodeType === "aggr_func") {
      hasAggregate = true;
    } else if (nodeType === "function") {
      const fn = getFunctionName(node.name);
      if (fn && AGGREGATE_FUNCTIONS.has(fn.toUpperCase())) {
        hasAggregate = true;
      }
    }

    if (nodeType === "select" && !isTopLevelStatement) {
      const isExplainPayload = parentType === "explain" && parentKey === "expr";
      if (!isExplainPayload) {
        hasSubquery = true;
      }
    }

    const currentType = typeof node.type === "string" ? node.type.toLowerCase() : undefined;
    for (const [key, value] of Object.entries(node)) {
      visit(value, false, currentType, key);
    }
  };

  for (const statement of statements) {
    visit(statement, true);
  }

  return { hasAggregate, hasSubquery };
}

export function collectStructuredFeatures(statements: AstNode[]): {
  where?: WhereNode;
  limit?: LimitNode;
  joins: JoinNode[];
  orderBy: OrderByNode[];
  groupBy: GroupByNode[];
} {
  let where: WhereNode | undefined;
  let limit: LimitNode | undefined;
  const joins: JoinNode[] = [];
  const orderBy: OrderByNode[] = [];
  const groupBy: GroupByNode[] = [];

  const roots: AstNode[] = [];
  for (const statement of statements) {
    roots.push(statement);
    const statementType = typeof statement.type === "string" ? statement.type.toLowerCase() : "";
    if (statementType === "explain" && isObject(statement.expr)) {
      roots.push(statement.expr);
    }
  }

  for (const node of roots) {
    if (!where && node.where !== null && node.where !== undefined) {
      where = toWhereNode(node.where);
    }
    if (!limit && node.limit !== null && node.limit !== undefined) {
      limit = toLimitNode(node.limit);
    }

    if (Array.isArray(node.from)) {
      for (const fromEntry of node.from) {
        if (!isObject(fromEntry)) {
          continue;
        }
        const joinType = typeof fromEntry.join === "string" ? fromEntry.join : undefined;
        if (!joinType) {
          continue;
        }
        const tableName = typeof fromEntry.table === "string" ? fromEntry.table : undefined;
        const schemaName = typeof fromEntry.db === "string" ? fromEntry.db : undefined;
        joins.push({
          type: joinType,
          table: tableName ? { name: tableName, schema: schemaName ?? undefined } : undefined,
          hasOn: fromEntry.on !== undefined && fromEntry.on !== null,
        });
      }
    }

    if (Array.isArray(node.orderby)) {
      for (const orderItem of node.orderby) {
        let direction: string | undefined;
        if (isObject(orderItem) && typeof orderItem.type === "string") {
          direction = orderItem.type.toUpperCase();
        }
        orderBy.push({
          direction,
          raw: orderItem,
        });
      }
    }

    if (isObject(node.groupby) && Array.isArray(node.groupby.columns)) {
      for (const groupItem of node.groupby.columns) {
        groupBy.push({ raw: groupItem });
      }
    } else if (node.groupby !== null && node.groupby !== undefined) {
      groupBy.push({ raw: node.groupby });
    }
  }

  return { where, limit, joins, orderBy, groupBy };
}
