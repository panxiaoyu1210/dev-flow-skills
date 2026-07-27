export function findCycles(nodes, edges, acyclicEdgeTypes) {
  const declaredTypes = new Set(acyclicEdgeTypes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map([...nodeIds].map((id) => [id, []]));

  for (const edge of edges) {
    if (!declaredTypes.has(edge.type) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    adjacency.get(edge.from).push(edge.to);
  }
  for (const targets of adjacency.values()) targets.sort();

  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const cycles = new Map();

  function visit(id) {
    state.set(id, 'visiting');
    stackIndex.set(id, stack.length);
    stack.push(id);

    for (const target of adjacency.get(id)) {
      if (state.get(target) === 'visiting') {
        const cycle = stack.slice(stackIndex.get(target));
        const sortedIds = [...new Set(cycle)].sort();
        cycles.set(sortedIds.join('\u0000'), sortedIds);
      } else if (!state.has(target)) {
        visit(target);
      }
    }

    stack.pop();
    stackIndex.delete(id);
    state.set(id, 'visited');
  }

  for (const id of [...nodeIds].sort()) {
    if (!state.has(id)) visit(id);
  }

  return [...cycles.values()].sort((left, right) => {
    const leftKey = left.join('\u0000');
    const rightKey = right.join('\u0000');
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
