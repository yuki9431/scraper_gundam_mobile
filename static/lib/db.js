var MATCH_DB_NAME = 'catalyzer';
// v2: 試合の一意キーをdate(分精度)からmatch_id優先に変更したため、
// 旧date単独キーのレコードが同一分の複数試合で相互上書きされていた問題(#358)を
// 一掃するためストアを再作成する。
var MATCH_DB_VERSION = 2;
var MATCH_STORE = 'matches';

function openMatchDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(MATCH_DB_NAME, MATCH_DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (db.objectStoreNames.contains(MATCH_STORE)) {
        db.deleteObjectStore(MATCH_STORE);
      }
      var store = db.createObjectStore(MATCH_STORE, { keyPath: 'id' });
      store.createIndex('userKey', 'user_key', { unique: false });
      store.createIndex('date', 'date', { unique: false });
      store.createIndex('ms', 'ms', { unique: false });
      store.createIndex('userKey_date', ['user_key', 'date'], { unique: false });
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

// matchRecordId はIndexedDBでのレコードIDを生成する。match_idがあればそれを、
// 無ければ(legacyデータ)date(分精度)をキーに使う（#358: date単独だと同一分の
// 複数試合が同じidになり相互上書きされる）。
export function matchRecordId(userKey, match) {
  return userKey + '_' + (match.match_id || match.date);
}

export function saveMatchesToDB(userKey, matches) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readwrite');
      var store = tx.objectStore(MATCH_STORE);
      for (var i = 0; i < matches.length; i++) {
        var m = Object.assign({}, matches[i], {
          id: matchRecordId(userKey, matches[i]),
          user_key: userKey
        });
        store.put(m);
      }
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  });
}

export function loadMatchesFromDB(userKey) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readonly');
      var store = tx.objectStore(MATCH_STORE);
      var index = store.index('userKey');
      var req = index.getAll(userKey);
      req.onsuccess = function (e) { resolve(e.target.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

