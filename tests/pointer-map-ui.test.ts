import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  completenessBadge,
  distinctModuleNames,
  filterPointerMapNodes,
  groupNodesByTarget,
  humanizeSnakeCase,
  isStaleReloadedNode,
  nodeStatusBadge,
  pointerMapDtoNodeChainSteps,
  sortPointerMapNodes,
} from '../src/app/live-memory/pointer-map-ui.ts';

function node(overrides: Partial<PointerMapNodeDto> = {}): PointerMapNodeDto {
  return {
    id: 'pm-1',
    label: 'candidate 1',
    path: { moduleName: 'game.exe', moduleOffset: '0x1a2b3c', offsets: [16, -8] },
    depth: 2,
    status: 'unresolved',
    lastResolvedAddress: null,
    lastResolvedAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    targetAddress: '0xdeadbeef',
    scanId: 'pms-1',
    ...overrides,
  };
}

describe('pointerMapDtoNodeChainSteps — chain-step formatting (mission §2, no re-derived semantics)', () => {
  test('root step is the module+offset, already-hex DTO string passed through untouched', () => {
    const steps = pointerMapDtoNodeChainSteps(node());
    assert.equal(steps[0].label, 'game.exe+0x1a2b3c');
    assert.equal(steps[0].isRoot, true);
  });

  test('positive and negative offsets both render with an explicit sign and hex magnitude', () => {
    const steps = pointerMapDtoNodeChainSteps(node());
    assert.deepEqual(
      steps.map((s) => s.label),
      ['game.exe+0x1a2b3c', '+0x10', '-0x8'],
    );
    assert.ok(steps.slice(1).every((s) => s.isRoot === false));
  });

  test('a root-only node (no offsets) yields exactly one step', () => {
    const steps = pointerMapDtoNodeChainSteps(node({ path: { moduleName: 'game.exe', moduleOffset: '0x100', offsets: [] } }));
    assert.equal(steps.length, 1);
  });

  test('depth is exposed on the node itself, independent of chain-step count', () => {
    const n = node({ depth: 5 });
    assert.equal(n.depth, 5);
  });
});

describe('nodeStatusBadge — a failed node must never look like a successful candidate (mission §5)', () => {
  test('resolved is the only status marked safe', () => {
    assert.equal(nodeStatusBadge('resolved').variant, 'safe');
    for (const status of ['unresolved', 'module_missing', 'read_failed', 'process_exited'] as const) {
      assert.notEqual(nodeStatusBadge(status).variant, 'safe', `${status} must not read as success`);
    }
  });

  test('module_missing and read_failed are both risky, process_exited is its own distinct blocked variant', () => {
    assert.equal(nodeStatusBadge('module_missing').variant, 'risky');
    assert.equal(nodeStatusBadge('read_failed').variant, 'risky');
    assert.equal(nodeStatusBadge('process_exited').variant, 'blocked');
    assert.notEqual(nodeStatusBadge('process_exited').label, nodeStatusBadge('read_failed').label);
  });
});

describe('isStaleReloadedNode — distinguishes "never resolved" from "unresolved after reload" (mission §5/§10)', () => {
  test('a node that has never been resolved is not stale', () => {
    assert.equal(isStaleReloadedNode(node({ status: 'unresolved', lastResolvedAt: null })), false);
  });

  test('a node forced back to unresolved by toInactiveOnLoad (P2-2) is stale', () => {
    assert.equal(isStaleReloadedNode(node({ status: 'unresolved', lastResolvedAt: '2026-09-15T00:00:00.000Z' })), true);
  });

  test('a currently-resolved node is never reported stale even with a resolved timestamp', () => {
    assert.equal(isStaleReloadedNode(node({ status: 'resolved', lastResolvedAt: '2026-09-15T00:00:00.000Z' })), false);
  });
});

describe('completenessBadge — COMPLETE must be distinguishable from every incomplete reason (mission §6)', () => {
  test('complete is the only state marked safe', () => {
    assert.equal(completenessBadge({ state: 'complete' }).variant, 'safe');
    const incompleteStates: Array<PointerMapCompletenessDto['state']> = [
      'complete_with_skipped_regions', 'cancelled', 'process_exited', 'resource_limit', 'failed',
    ];
    for (const state of incompleteStates) {
      assert.notEqual(completenessBadge({ state }).variant, 'safe', `${state} must not read as complete`);
    }
  });

  test('cancelled and resource_limit are visibly distinct labels from complete', () => {
    assert.notEqual(completenessBadge({ state: 'cancelled' }).label, completenessBadge({ state: 'complete' }).label);
    assert.notEqual(completenessBadge({ state: 'resource_limit' }).label, completenessBadge({ state: 'complete' }).label);
  });

  test('process_exited during a scan reads as its own blocked variant, not merely risky/failed', () => {
    assert.equal(completenessBadge({ state: 'process_exited', atByte: '0x0' }).variant, 'blocked');
  });
});

describe('humanizeSnakeCase', () => {
  test('capitalizes the first word and spaces the rest', () => {
    assert.equal(humanizeSnakeCase('resource_limit_reached'), 'Resource limit reached');
  });

  test('single word still gets capitalized', () => {
    assert.equal(humanizeSnakeCase('cancelled'), 'Cancelled');
  });

  test('empty string passes through unchanged', () => {
    assert.equal(humanizeSnakeCase(''), '');
  });
});

describe('groupNodesByTarget — multi-target UX must never flatten two targets into one list (mission §4)', () => {
  test('two independent targets stay in two distinct, correctly-populated groups', () => {
    const nodes = [
      node({ id: 'a1', targetAddress: '0xaaaa' }),
      node({ id: 'b1', targetAddress: '0xbbbb' }),
      node({ id: 'a2', targetAddress: '0xaaaa' }),
    ];
    const groups = groupNodesByTarget(nodes);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].nodes.map((n) => n.id), ['a1', 'a2']);
    assert.deepEqual(groups[1].nodes.map((n) => n.id), ['b1']);
  });

  test('manually-added nodes (targetAddress null) form their own group, not merged into a scanned target', () => {
    const nodes = [node({ id: 'scanned', targetAddress: '0xaaaa' }), node({ id: 'manual', targetAddress: null })];
    const groups = groupNodesByTarget(nodes);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.targetAddress === null)?.nodes[0].id, 'manual');
  });

  test('an empty node list produces zero groups, not a phantom empty group', () => {
    assert.deepEqual(groupNodesByTarget([]), []);
  });
});

describe('filterPointerMapNodes / sortPointerMapNodes — navigation helpers (mission §12)', () => {
  const nodes = [
    node({ id: 'n1', depth: 3, status: 'resolved', path: { moduleName: 'a.exe', moduleOffset: '0x1', offsets: [] } }),
    node({ id: 'n2', depth: 1, status: 'read_failed', path: { moduleName: 'b.exe', moduleOffset: '0x2', offsets: [] } }),
    node({ id: 'n3', depth: 2, status: 'resolved', path: { moduleName: 'a.exe', moduleOffset: '0x3', offsets: [] } }),
  ];

  test('filters by status', () => {
    assert.deepEqual(filterPointerMapNodes(nodes, { status: 'resolved' }).map((n) => n.id), ['n1', 'n3']);
  });

  test('filters by module', () => {
    assert.deepEqual(filterPointerMapNodes(nodes, { module: 'b.exe' }).map((n) => n.id), ['n2']);
  });

  test('filters by exact depth', () => {
    assert.deepEqual(filterPointerMapNodes(nodes, { depth: 2 }).map((n) => n.id), ['n3']);
  });

  test('sorts by depth ascending without mutating the input array', () => {
    const original = [...nodes];
    const sorted = sortPointerMapNodes(nodes, 'depth');
    assert.deepEqual(sorted.map((n) => n.id), ['n2', 'n3', 'n1']);
    assert.deepEqual(nodes, original, 'input array must not be mutated');
  });

  test('sorts by module name', () => {
    assert.deepEqual(sortPointerMapNodes(nodes, 'module').map((n) => n.id), ['n1', 'n3', 'n2']);
  });

  test('"order" sort returns scan order (a copy, not the same reference)', () => {
    const sorted = sortPointerMapNodes(nodes, 'order');
    assert.deepEqual(sorted.map((n) => n.id), ['n1', 'n2', 'n3']);
    assert.notEqual(sorted, nodes);
  });
});

describe('distinctModuleNames', () => {
  test('returns each module once, in first-seen order', () => {
    const nodes = [
      node({ path: { moduleName: 'b.exe', moduleOffset: '0x1', offsets: [] } }),
      node({ path: { moduleName: 'a.exe', moduleOffset: '0x2', offsets: [] } }),
      node({ path: { moduleName: 'b.exe', moduleOffset: '0x3', offsets: [] } }),
    ];
    assert.deepEqual(distinctModuleNames(nodes), ['b.exe', 'a.exe']);
  });
});

describe('large-map UX — grouping/filtering/sorting stay correct at the P2-2 map cap (mission §11)', () => {
  for (const size of [1, 10, 50, 100, 200]) {
    test(`groups and sorts a ${size}-node map correctly`, () => {
      const nodes = Array.from({ length: size }, (_, i) =>
        node({ id: `n${i}`, targetAddress: i % 2 === 0 ? '0xaaaa' : '0xbbbb', depth: (i % 6) + 1 }),
      );
      const groups = groupNodesByTarget(nodes);
      assert.equal(groups.reduce((sum, g) => sum + g.nodes.length, 0), size);
      const sorted = sortPointerMapNodes(nodes, 'depth');
      assert.equal(sorted.length, size);
      for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].depth >= sorted[i - 1].depth);
    });
  }
});
