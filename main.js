
var sql = window.SQL;

function todo() {
  var db = new sql.Database();
  // type has to be integer, not int, if null is used to get an unused id without autoincrement

  // sadly, even though we want
  // unique (ordinal, project_id)
  // on the tasks table, we leave it out for practical reasons.
  // e.g. two rows contain 1 and 2, and i run update table set col = col + 1;
  // the order in which the rows are updated matters, so one order is fine
  // and the other produces a unique constraint violation. there doesn't
  // seem to be a nice way to handle this without hacks involving
  // copying the rows into a temporary table.

  db.run(`
  pragma foreign_keys = on;

  create table tasks (
    id integer primary key,
    done boolean,
    desc text,
    project_id integer,
    ordinal integer,
    foreign key (project_id) references projects(id)
  );
  create table projects (
    id integer primary key,
    name text,
    ordinal integer,
    unique (ordinal)
  );
  create table task_deps (
    t_from integer,
    t_to integer,
    foreign key (t_from) references tasks(id) on delete cascade,
    foreign key (t_to) references tasks(id) on delete cascade,
    unique (t_from, t_to)
  );
  create table tags (
    task_id int,
    name text,
    foreign key (task_id) references tasks(id) on delete cascade
  );
  create table queries (
    query text
  );
  `);

  db.run(`
    insert into projects values (null, 'inbox', 0);
    insert into tasks values (null, 0, 'hello', 1, 0);
    insert into tags values (1, 'home');
    insert into tags values (1, 'commute');
  `);
  return db;
}

function results(r) {
  if (!r.length) {
    return [];
  } else {
    return r[0].values;
  }
}

function query(query, values) {
  var stmt = window.database.prepare(query);
  stmt.bind(values);
  var result = [];
  var r;
  while (r = stmt.step()) {
    result.push(stmt.get())
  }
  stmt.free();
  return [{values: result}];
}

var { patch, elementVoid, elementClose, elementOpen, text } = IncrementalDOM;

// debounce

var debounce = (function () {
  let timer = 0;
  return (f) => {
    timer++;
    setTimeout(() => {
      timer--;
      if (timer === 0) {
        f();
      }
    }, 6000);
  };
})();

var database = todo();

// derived/transient state which is okay to forget
var state = {
  more: false,
  chosenProject: { name: 'inbox', id: 1 },
  blockee: null,
  dirty: false,
  autosave: false,
};

function save() {
  var token = window.localStorage.gttdDropboxToken;
  if (!token) {
    return;
  }

  new Dropbox.Dropbox({ accessToken: token, fetch: fetch })
    .filesUpload({contents: database.export().buffer, path: '/todo.db', mode: {'.tag': 'overwrite'}})
    .then(function() {
      console.log('saved');
      window.state.dirty = false;
      update();
    })
    .catch(function (error) {
      console.log(error);
    });
}

// idempotent, pre-update initialization. occurs after a database is loaded,
// so should restore the starting state
function on_init() {
  database.run('pragma foreign_keys = on;');

  let [id, name] = results(database.exec('select id, name from projects order by ordinal limit 1'))[0];
  state.chosenProject = { name, id };

  state.blockee = null;
  state.dirty = false;
}

function dirty() {
  window.state.dirty = true;
  if (window.state.autosave) {
    debounce(save);
  }
}

function render() {

  elementOpen('div');

  // add task
  elementVoid('input', null, ['placeholder', 'add task', 'onkeypress', e => {
    if (e.keyCode === 13) {
      var text = e.target.value;
      // the null uses the existing sequence, however the create event loses its id
      query('update tasks set ordinal = ordinal + 1 where project_id = ?;',
        [window.state.chosenProject.id]);
      query('insert into tasks values (null, 0, ?, ?, 0);',
        [text, window.state.chosenProject.id]);
      e.target.value = '';
      dirty();
      update();
    }
  }]);

  // change project
  elementOpen('select', null, ['onchange', e => {
    let id = e.target.options[e.target.selectedIndex].getAttribute('project_id')
    window.state.chosenProject = { name: e.target.value, id: id };
    update();
  }]);
  // this should not be empty
  var projects = results(database.exec('select id, name from projects order by ordinal;'));
  projects.forEach(t => {
    let [id, name] = t;
    elementOpen('option', null, ['value', name, 'project_id', id]);
    text(name)
    elementClose('option');
  });
  elementClose('select');

  // dirty
  if (window.state.dirty) {
    elementOpen('span');
    text('*')
    elementClose('span');
  }

  // more/less
  elementOpen('div');
  elementOpen('a', null, ['href', '#', 'onclick', _ => {
    window.state.more = !window.state.more;
    update();
  }]);
  text(window.state.more ? 'less' : 'more')
  elementClose('a');
  elementClose('div');

  if (window.state.more) {
    elementOpen('div');
    // export
    elementOpen('a', null, ['href', '#', 'onclick', e => {
      var result = [];
      result.push('tasks')
      results(database.exec('select * from tasks;')).forEach(v => result.push(JSON.stringify(v)));
      result.push('projects')
      results(database.exec('select * from projects;')).forEach(v => result.push(JSON.stringify(v)));
      result.push('deps')
      results(database.exec('select * from task_deps;')).forEach(v => result.push(JSON.stringify(v)));
      result.push('tags')
      results(database.exec('select * from tags;')).forEach(v => result.push(JSON.stringify(v)));

      var exportField = document.createElement('textarea');
      exportField.value = result.join('\n');
      e.target.insertAdjacentElement("afterend", exportField);
      e.target.remove();
    }]);
    text('export')
    elementClose('a');
    elementClose('div');

    // clear done
    elementOpen('div');
    elementOpen('a', null, ['href', '#', 'onclick', _ => {
      query('delete from tasks where id in (select t.id from tasks t inner join projects p on p.id = t.project_id where t.done and p.id = ?);',
        [window.state.chosenProject.id]);
      dirty();
      update();
    }]);
    text('clear done')
    elementClose('a');
    elementClose('div');

    // token
    elementOpen('div');
    elementVoid('input', null, ['placeholder', 'dropbox token', 'onkeypress', e => {
      if (e.keyCode === 13) {
        var text = e.target.value;
        // https://www.dropbox.com/developers/apps
        // https://blogs.dropbox.com/developers/2014/05/generate-an-access-token-for-your-own-account/
        window.localStorage.gttdDropboxToken = text;
        update();
      }
    }], 'value', window.localStorage.gttdDropboxToken || '');
    elementClose('div');

    // autosave
    elementOpen('div');
    elementVoid.apply(null, ['input', null, ['type', 'checkbox', 'onchange', e => {window.state.autosave = !window.state.autosave;}]]
      .concat(window.state.autosave ? ['checked', 'lol'] : []))
    text('autosave')
    elementClose('div');

    // save
    elementOpen('div');
    elementOpen('a', null, ['href', '#', 'onclick', save]);
    text('save')
    elementClose('a');
    elementClose('div');

    // load
    elementOpen('div');
    elementOpen('a', null, ['href', '#', 'onclick', e => {

      var token = window.localStorage.gttdDropboxToken;
      if (!token) {
        return;
      }

      new Dropbox.Dropbox({ accessToken: token, fetch: fetch })
        .filesDownload({path: '/todo.db'})
        .then(function (response) {
          var blob = response.fileBlob;
          var reader = new FileReader();
          reader.addEventListener("loadend", function(e) {
            var ab = e.target.result;
            var u8a  = new Uint8Array(ab);
            window.database = new sql.Database(u8a);
            on_init();
            update();
          });
          reader.readAsArrayBuffer(blob);
        })
        .catch(function (error) {
          console.log(error);
        });

    }]);
    text('load')
    elementClose('a');
    elementClose('div');

    // add project
    elementOpen('div');
    elementVoid('input', null, ['placeholder', 'add project', 'onkeypress', e => {
      if (e.keyCode === 13) {
        var text = e.target.value;
        query('insert into projects select null, ?, (select 1+max(ordinal) from projects);', [text]);
        e.target.value = '';
        dirty();
        update();
      }
    }]);
    elementClose('div');
  }

  elementOpen('ul');

  var tasks = query(`
    select t.*
    from tasks t
    where t.project_id = ?
    order by t.done, t.ordinal;`, [window.state.chosenProject.id]);

  // assume that dependencies don't span projects
  var deps = query(`
    select distinct td.*
    from task_deps td, tasks t
    where t.project_id = ?
    and td.t_from = t.id or td.t_to = t.id;`, [window.state.chosenProject.id]);

  tasks = results(tasks);
  deps = results(deps);

  function reorder_tasks() {
    let done = tasks.filter(t => t[1]);
    let undone = tasks.filter(t => !t[1]);

    let task_map = {};
    undone.forEach(u => task_map[u[0]] = u);

    let ids = undone.map(t => t[0]);

    let ids1 = stable_toposort(deps, ids);

    return ids1.map(i => task_map[i]).concat(done);
  }

  tasks = reorder_tasks();

  tasks.forEach(t => {
    let [id, checked, desc, project_id, ordinal] = t;
    checked = !!checked;
    elementOpen('li');

    function on_change(id, checked) {
      query(`update tasks set done = ? where id = ?`, [+checked, id]);
      dirty();
      update();
    }

    // work around https://github.com/google/incremental-dom/issues/198
    elementVoid.apply(null,
      ['input', `task-checkbox-${id}`, ['type', 'checkbox', 'onchange', e => on_change(id, e.target.checked)]]
        .concat(checked ? ['checked', 'lol'] : []))
    text(ordinal + ' ' + desc);
    // text(desc);

    elementOpen('a', `task-more-${id}`, ['href', '#', 'onclick', e => {
      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      // projects
      var projectsSelect = document.createElement('select');
      projectsSelect.onchange = e => {
        let project_id = e.target.options[e.target.selectedIndex].getAttribute('project_id')
        query('update tasks set project_id = ? where id = ?', [project_id, id]);
        dirty();
        update();
      };
      projects.forEach(t => {
        let [id, name] = t;
        let opt = document.createElement('option');
        opt.setAttribute('value', name);
        opt.setAttribute('project_id', id);
        if (id === project_id) {
          opt.setAttribute('selected', true);
        }
        opt.innerHTML = name;
        projectsSelect.appendChild(opt);
      });
      e.target.insertAdjacentElement("beforeBegin", projectsSelect);

      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      // blocked by
      var blockedBy = document.createElement('a');
      blockedBy.innerHTML = 'blocked by';
      blockedBy.setAttribute('href', '#');
      blockedBy.onclick = e => {
        window.state.blockee = id;
      };
      e.target.insertAdjacentElement("beforeBegin", blockedBy);
      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      var byThis = document.createElement('a');
      byThis.setAttribute('href', '#');
      byThis.innerHTML = 'this';
      byThis.onclick = e => {
        if (window.state.blockee !== null && window.state.blockee !== id) {
          query('insert into task_deps values (?, ?)',
            [window.state.blockee, id]);
          window.state.blockee = null;
          dirty();
          update();
        }
      };
      e.target.insertAdjacentElement("beforeBegin", byThis);
      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      // top and bottom
      var toTop = document.createElement('a');
      toTop.setAttribute('href', '#');
      toTop.innerHTML = 'top';
      toTop.onclick = e => {
        query('update tasks set ordinal = ordinal + 1 where project_id = ? and id <> ?;', [window.state.chosenProject.id, id]);
        query('update tasks set ordinal = 0 where id = ?;', [id]);
        dirty();
        update();
      };
      e.target.insertAdjacentElement("beforeBegin", toTop);
      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      var toBottom = document.createElement('a');
      toBottom.setAttribute('href', '#');
      toBottom.innerHTML = 'bottom';
      toBottom.onclick = e => {
        query('update tasks set ordinal = 1+(select max(ordinal) from tasks where project_id = ?) where id = ?;',
          [window.state.chosenProject.id, id]);
        dirty();
        update();
      };
      e.target.insertAdjacentElement("beforeBegin", toBottom);

      e.target.insertAdjacentElement("beforeBegin", document.createElement('br'));

      // tags
      var tagsField = document.createElement('input');
      tagsField.setAttribute("placeholder", "tags");
      var tags = query('select name from tags where task_id = ?', [id]);
      if (tags.length) {
        tagsField.value = tags[0].values.join(',');
      }
      tagsField.onkeypress = e => {
        if (e.keyCode === 13) {
          var text = e.target.value;
          text.split(',').forEach(t => {
              query('delete from tags where task_id = ?', [id]);
              query('insert into tags values (?, ?)', [id, t.trim()]);
          });
          dirty();
          update();
        }
      };
      e.target.insertAdjacentElement("beforeBegin", tagsField);

      e.target.remove();
    }]);
    text('...')
    elementClose('a');

    elementClose('li');
  });
  elementClose('ul');
  elementClose('div');
}

function update() {
  patch(document.querySelector('#list'), render);
}

document.querySelector('#loading').remove()
update();
