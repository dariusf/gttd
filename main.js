
var sql = window.SQL;

function todo() {
  var db = new sql.Database();
  // type has to be integer, not int, if null is used to get an unused id without autoincrement
  db.run(`
  create table tasks (
    id integer primary key,
    done boolean,
    desc text);
  create table tags (
    task_id int,
    name text,
    foreign key (task_id) references tasks(id));
  `);

  db.run(`
    insert into tasks values (1, 0, 'hello');
    insert into tags values (1, 'inbox');
    insert into tags values (1, 'next');`);
  return db;
}

var { patch, elementVoid, elementClose, elementOpen, text } = IncrementalDOM;

var database = todo();

// derived/transient state which is okay to forget
var state = {
  more: false,
  chosenTag: 'inbox',
};

function render() {

  elementOpen('div');
  elementVoid('input', null, ['placeholder', 'add task', 'onkeypress', e => {
    if (e.keyCode === 13) {
      var text = e.target.value;
      // the null uses the existing sequence, however the create event loses its id
      database.exec(`
        insert into tasks values (null, 0, '${text}');
        insert into tags select last_insert_rowid(), '${window.state.chosenTag}';
      `);
      e.target.value = '';
      update();
    }
  }]);

  elementOpen('select', null, ['onchange', e => {
    window.state.chosenTag = e.target.value;
    update();
  }]);
  // this should not be empty
  var tags = database.exec('select distinct name from tags;')[0].values;
  tags.forEach(t => {
    elementOpen('option', null, ['value', t]);
    text(t)
    elementClose('option');
  });
  elementClose('select');

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
    elementOpen('a', null, ['href', '#', 'onclick', e => {
      var result = [];
      result.push('tasks')
      database.exec('select * from tasks;')[0].values.forEach(v => result.push(JSON.stringify(v)));
      result.push('tags')
      database.exec('select * from tags;')[0].values.forEach(v => result.push(JSON.stringify(v)));

      var exportField = document.createElement('textarea');
      exportField.value = result.join('\n');
      e.target.insertAdjacentElement("afterend", exportField);
      e.target.remove();
    }]);
    text('export')
    elementClose('a');
    elementClose('div');

    elementOpen('div');
    elementOpen('a', null, ['href', '#', 'onclick', _ => {
      database.run(`delete from tasks where id in (select t.id from tasks t inner join tags ta on ta.task_id = t.id where t.done and ta.name = '${window.state.chosenTag}');`);
      update();
    }]);
    text('clear done')
    elementClose('a');
    elementClose('div');

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
    elementOpen('div');
    elementOpen('a', null, ['href', '#', 'onclick', e => {

      var token = window.localStorage.gttdDropboxToken;
      if (!token) {
        return;
      }

      new Dropbox.Dropbox({ accessToken: token, fetch: fetch })
        .filesUpload({contents: database.export().buffer, path: '/todo.db', mode: {'.tag': 'overwrite'}})
        .then(function() {
          console.log('saved');
        })
        .catch(function (error) {
          console.log(error);
        });

    }]);
    text('save')
    elementClose('a');
    elementClose('div');
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
  }

  elementOpen('ul');

  var tasks = database.exec(`
    select distinct t.*
    from tasks t
    left join tags ta on ta.task_id = t.id
    where ta.name = '${window.state.chosenTag}';`);

  // TODO factor out
  if (!tasks.length) {
    tasks = [];
  } else {
    tasks = tasks[0].values;
  }

  tasks.forEach(t => {
    let [id, checked, desc] = t;
    checked = !!checked;
    elementOpen('li');

    function on_change(id, checked) {
      database.run(`update tasks set done = ${+checked} where id = ${id}`);
      update();
    }

    // work around https://github.com/google/incremental-dom/issues/198
    elementVoid.apply(null,
      ['input', id, ['type', 'checkbox', 'onchange', e => on_change(id, e.target.checked)]]
        .concat(checked ? ['checked', 'lol'] : []))
    text(desc);

    elementOpen('a', null, ['href', '#', 'onclick', e => {
      var tagsField = document.createElement('input');
      tagsField.setAttribute("placeholder", "tags");
      var tags = database.exec(`select name from tags where task_id = ${id}`);
      if (tags.length) {
        tagsField.value = tags[0].values.join(',');
      }
      tagsField.onkeypress = e => {
        if (e.keyCode === 13) {
          var text = e.target.value;
          text.split(',').forEach(t => {
            database.exec(`
              delete from tags where task_id = ${id};
              insert into tags values (${id}, '${t.trim()}')
            `);
          });
          update();
        }
      };
      e.target.insertAdjacentElement("afterend", tagsField);
      e.target.remove();
    }]);
    text('?')
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
