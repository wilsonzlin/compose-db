"use strict";

const fs = require('fs-extra');
const luamin = require('luamin');
const minimist = require("minimist");

const ARGS = minimist(process.argv.slice(2));

const IN_DIR = ARGS.in;
const OUT_DIR = ARGS.out;

fs.readdirSync(IN_DIR).filter(f => /\.json$/.test(f)).map(f => f.slice(0, -5)).forEach(f => {
  let databases = JSON.parse(fs.readFileSync(`${IN_DIR}/${f}.json`, 'utf8'));

  if (databases.length < 1 || databases.length > 2) {
    throw new SyntaxError("Invalid amount of databases");
  }

  let coreDatabase = databases.find(db => db.type == "fixed");
  let instDatabase = databases.find(db => db.type == "instance");

  let luaCode = `
        local FrozenTableMetatable = require('Base.Lua.FrozenTableMetatable')
        local Set = require('Base.DataStructure.Set')

        local Schema = {}
    `;
  if (coreDatabase) {
    luaCode += `
            Schema.core = {}
            Schema.core._objectType = "database"
            Schema.core._objectName = "${coreDatabase.name}"
        `;
  }
  if (instDatabase) {
    luaCode += `
            Schema.inst = {}
            Schema.inst._objectType = "database"
        `;
  }

  function objectToLua(obj) {
    let luaCode = '{';

    Object.keys(obj).forEach(k => {
      let key = k;
      if (/^[0-9]+$/.test(key)) {
        key = Number.parseInt(k, 10);
      }
      switch (typeof key) {
        case "number":
          key = "[" + key + "]";
          break;
      }

      let value = obj[k];
      switch (typeof value) {
        case "string":
          value = `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
          break;

        case "object":
          // In general, there should be no nested objects: 1) flat is better 2) it's easier to setmetatable
          /* OVERRIDE: Do not detect null, as it's useless to set to nil
          if (value == null) {
          value = "nil"; // this is useless
          } else {
          */
          throw new SyntaxError("Detected nested object within column object");
          break;
      }
      luaCode += `${key} = ${value},`;
    });

    luaCode += '}';

    return luaCode;
  }

  function writeTable(type, table) {
    luaCode += `
            Schema.${type}.${table.name} = {}
            Schema.${type}.${table.name}._objectType = "table"
            Schema.${type}.${table.name}._objectName = "${table.name}"
        `;
    table.columns.forEach(column => {
      let name = column.name;
      if (column.type == "FK") {
        let parts = column.column.split('.');
        let fkDatabase, fkTable, fkColName;
        if (parts.length == 3) {
          [fkDatabase, fkTable, fkColName] = parts;
        } else {
          [fkTable, fkColName] = parts;
        }
        let db;
        if (fkDatabase == undefined) {
          db = type == 'core' ? coreDatabase : instDatabase;
        } else {
          db = fkDatabase == coreDatabase.name ? coreDatabase : instDatabase;
        }
        let fkCol = db.tables.find(t => t.name == fkTable).columns.find(col => col.name == fkColName);
        if (!fkCol) {
          throw new ReferenceError(`${column.column} column for FK not found`);
        }
        let nullable = column.nullable;
        column = Object.assign({}, fkCol, {
          name: name,
          nullable: nullable,
        });
        delete column.values; // In case FK is to a Code type column and it hasn't been processed yet
      }
      // column.type may have changed due to FK, so need to recheck
      if (column.type == "integer") {
        if (column.minValue == undefined) {
          if (column.autoIncrement) {
            column.minValue = 1;
          } else if (column.unsigned) {
            column.minValue = 0;
          } else {
            switch (column.size) {
              case "TINYINT":
                column.minValue = -128;
                break;

              case "SMALLINT":
                column.minValue = -32768;
                break;

              case "MEDIUMINT":
                column.minValue = -8388608;
                break;

              case "INT":
                column.minValue = -2147483648;
                break;

              case "BIGINT":
                // OVERRIDE: -99999999999999 is Lua's largest integer-representable negative number on x64
                column.minValue = -99999999999999;
                break;

              default:
                throw new SyntaxError("Unrecognised integer type: " + column.size);
            }
          }
        }
        if (column.maxValue == undefined) {
          switch (column.size) {
            case "TINYINT":
              column.maxValue = column.unsigned ? 255 : 127;
              break;

            case "SMALLINT":
              column.maxValue = column.unsigned ? 65535 : 32767;
              break;

            case "MEDIUMINT":
              column.maxValue = column.unsigned ? 16777215 : 8388607;
              break;

            case "INT":
              column.maxValue = column.unsigned ? 4294967295 : 2147483647;
              break;

            case "BIGINT":
              // OVERRIDE: 99999999999999 is Lua's largest integer-representable number on x64
              // column.maxValue = column.unsigned ? 18446744073709551615 : 9223372036854775807;
              column.maxValue = column.unsigned ? 99999999999999 : 99999999999999;
              break;

            default:
              throw new SyntaxError("Unrecognised integer type: " + column.size);
          }
        }
      } else if (column.type == "serial") {
        column.minValue = 1;
        switch (column.size) {
          case "TINYINT":
            column.maxValue = 255;
            break;

          case "SMALLINT":
            column.maxValue = 65535;
            break;

          case "MEDIUMINT":
            column.maxValue = 16777215;
            break;

          case "INT":
            column.maxValue = 4294967295;
            break;

          case "BIGINT":
            // OVERRIDE: 99999999999999 is Lua's largest integer-representable number on x64
            // column.maxValue = 18446744073709551615;
            column.maxValue = 99999999999999;
            break;

          default:
            throw new SyntaxError("Unrecognised serial size: " + column.size);
        }
      }
      delete column.comments;
      column._objectType = "column";

      let codeValuesLua = "";
      if (column.type == "code" && column.values) { // If this is actually a FK column referencing a Code column, then column.values does not exist
        column.values.forEach(value => {
          codeValuesLua += `
                        Schema.${type}.${table.name}.${column.name}.${value.value} = ${value.code}
                        Schema.${type}.${table.name}.${column.name}[${value.code}] = "${value.value}"
                    `;
        });
        let validCodes = column.values.map(v => v.code).join(",");
        codeValuesLua += `
                    Schema.${type}.${table.name}.${column.name}.codes = Set:new({${validCodes}})
                `;
        delete column.values;
      }

      luaCode += `
                Schema.${type}.${table.name}.${column.name} = ${objectToLua(column)}
                Schema.${type}.${table.name}.${column.name}._parentTable = Schema.${type}.${table.name}
                ${codeValuesLua}
                setmetatable(Schema.${type}.${table.name}.${column.name}, FrozenTableMetatable)
            `;
    });
    luaCode += `
            setmetatable(Schema.${type}.${table.name}, FrozenTableMetatable)
        `;
  }

  if (coreDatabase) {
    coreDatabase.tables.forEach(table => {
      writeTable('core', table);
    });

    luaCode += `
            setmetatable(Schema.core, FrozenTableMetatable)
        `;
  }
  if (instDatabase) {
    instDatabase.tables.forEach(table => {
      writeTable('inst', table);
    });

    luaCode += `
            setmetatable(Schema.inst, FrozenTableMetatable)
        `;
  }

  luaCode += `
        setmetatable(Schema, FrozenTableMetatable)

        return Schema
    `;

  luaCode = luamin.minify(luaCode);

  fs.outputFileSync(`${OUT_DIR}/${f}.lua`, luaCode);
});
