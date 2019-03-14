(function () {

  // converts an edge list into a dependency map
  function to_dep_map(edges) {
    var deps = {}
    edges.forEach(e => {
      let [a, b] = e;
      deps[a] = deps[a] || {};
      deps[a][b] = deps[a][b] || true;
    });
    return deps;
  }

  // traverses a dependency map to collect all transitive dependencies
  function all_transitive(map, a) {
    let neighbours = Object.keys(map[a] || {}).filter(k => map[a][k]);
    if (neighbours.length === 0) {
      return [];
    } else {
      let children = neighbours.map(n => {
        return all_transitive(map, n);
      }).reduceRight((t, c) => t.concat(c));
      return neighbours.concat(children);
    }
  }

  // null-safe direct dependency check
  function has_direct_dep(map, a, b) {
    if (!map[a]) {
      map[a] = {};
    }
    return map[a][b];
  }

  // memoizing transitive dependency check
  // TODO does not memoize as much as it should,
  // e.g. does not do b -> c when doing a -> b -> c
  function has_transitive_dep(map, a, b) {
    let r = has_direct_dep(map, a, b);
    if (r === undefined) {
      // not direct, maybe transitive
      all_transitive(map, a).forEach(c => {
        map[a][c] = true;
      });
      if (!map[a][b]) {
        map[a][b] = false;
      }
      return map[a][b];
    } else {
      // direct or transitive
      return r;
    }
  }

  // http://blog.gapotchenko.com/stable-topological-sort
  function stable_toposort(edges, list) {

    // edges is a list of [a, b] pairs where a -- depends on -> b
    let direct = to_dep_map(edges);
    let transitive = to_dep_map(edges);

    let result = list.slice()
    let n = result.length;
    while (true) {
      for (let i = 0; i < n; ++i) {
        for (let j = 0; j < i; ++j) {
          if (has_direct_dep(direct, result[j], result[i])) {
            let jOnI = has_transitive_dep(transitive, result[j], result[i]);
            let iOnJ = has_transitive_dep(transitive, result[i], result[j]);

            let circularDependency = jOnI && iOnJ;

            if (!circularDependency) {
              let t = result[i];
              result.splice(i, 1);
              result.splice(j, 0, t);
              continue;
            }
          }
        }
      }
      break;
    }

    return result;
  }

  // stable_toposort([[1,2],[2,4]], [1,2,3,4,5,6])

  window.stable_toposort = stable_toposort;

})();