"use strict";

const fs = require('fs-extra');
const sprintf = require('sprintf-js').sprintf;
const minimist = require("minimist");

const ARGS = minimist(process.argv.slice(2));

const IN_DIR = ARGS.in;
const OUT_DIR = ARGS.out;

const INTEGER_SIZES = new Set(["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT"]);

const INTEGER_MIN = {
    TINYINT: -128,
    SMALLINT: -32768,
    MEDIUMINT: -8388608,
    INT: -2147483648,
    BIGINT: -99999999999999,
};

const INTEGER_MAX_UNSIGNED = {
    TINYINT: 255,
    SMALLINT: 65535,
    MEDIUMINT: 16777215,
    INT: 4294967295,
    BIGINT: 99999999999999,
};

const INTEGER_MAX_SIGNED = {
    TINYINT: 127,
    SMALLINT: 32767,
    MEDIUMINT: 8388607,
    INT: 2147483647,
    BIGINT: 99999999999999,
};

function processIntegerColumn(col) {
    let size = col.size;
    if (!INTEGER_SIZES.has(size)) {
        throw new TypeError(`Integer column has invalid size "${size}"`);
    }

    let isUnsigned = col.unsigned;
    let absMin = isUnsigned ? 0 : INTEGER_MIN[size];
    let absMax = isUnsigned ? INTEGER_MAX_UNSIGNED[size] : INTEGER_MAX_SIGNED[size];

    let minimum = col.minValue;
    if (minimum != undefined) {
        if (minimum < absMin) {
            throw new RangeError(`Integer column has out-of-range minimum value "${minimum}"`);
        }
    }

    let maximum = col.maxValue;
    if (maximum != undefined) {
        if (maximum > absMax) {
            throw new RangeError(`Integer column has out-of-range maximum value "${maximum}"`);
        }
    }

    let defaultValue = col.defaultValue;
    if (defaultValue != undefined) {
        if (!Number.isSafeInteger(defaultValue)) {
            throw new TypeError(`Integer column has non-integer default value "${defaultValue}"`);
        }
        if (defaultValue < absMin || defaultValue > absMax) {
            throw new RangeError(`Integer column has out-of-range default value "${defaultValue}"`);
        }
    }

    let nullable = col.nullable;

    return sprintf("%s %s %s %s",
        size,
        isUnsigned ? "UNSIGNED" : "",
        nullable ? "NULL" : "NOT NULL",
        defaultValue != undefined ? ("DEFAULT " + defaultValue) : ""
    );
}

function processSerialColumn(col) {
    let size = col.size;
    if (!INTEGER_SIZES.has(size)) {
        throw new TypeError(`Serial column has invalid size "${size}"`);
    }

    return sprintf("%s UNSIGNED NOT NULL AUTO_INCREMENT",
        size
    );
}

function processTimestampColumn(col) {
    let isUnsigned = col.unsigned;
    let defaultValue = col.defaultValue;

    if (defaultValue != undefined) {
        if (!isUnsigned) {
            throw new Error(`Default values for signed timestamps are not allowed`);
        }
        if (defaultValue !== 0) {
            throw new RangeError(`Timestamp column has non-zero default value "${defaultValue}"`);
        }
    }

    return sprintf("BIGINT UNSIGNED NOT NULL %s",
        defaultValue != undefined ? ("DEFAULT " + defaultValue) : ""
    );
}

function processStringColumn(col) {
    let minimumLength = col.minLength;
    let maximumLength = col.maxLength;

    if (!Number.isSafeInteger(maximumLength)) {
        throw new TypeError(`String column has non-integer maximum length "${maximumLength}"`);
    }

    if (minimumLength != undefined) {
        if (!Number.isSafeInteger(minimumLength)) {
            throw new TypeError(`String column has non-integer minimum length "${minimumLength}"`);
        }

        if (minimumLength < 1 || minimumLength > maximumLength) {
            throw new RangeError(`String column has out-of-range minimum length`);
        }
    }

    let defaultValue = col.defaultValue;

    if (defaultValue != undefined) {
        if (defaultValue !== "''" && defaultValue !== '""') {
            throw new Error(`String column has non-empty literal string default value "${defaultValue}"`);
        }
    }

    let nullable = col.nullable;

    return sprintf("VARCHAR(%d) %s %s",
        maximumLength,
        nullable ? "NULL" : "NOT NULL",
        defaultValue != undefined ? "DEFAULT ''" : ""
    );
}

function processBinaryColumn(col) {
    let minimumSize = col.minSize;
    let maximumSize = col.maxSize;

    if (!Number.isSafeInteger(maximumSize)) {
        throw new TypeError(`Binary column has non-integer maximum length "${maximumSize}"`);
    }

    if (minimumSize != undefined) {
        if (!Number.isSafeInteger(minimumSize)) {
            throw new TypeError(`Binary column has non-integer minimum length "${minimumSize}"`);
        }

        if (minimumSize < 1 || minimumSize > maximumSize) {
            throw new RangeError(`Binary column has out-of-range minimum length`);
        }
    } else {
        minimumSize = 0;
    }

    let defaultValue = col.defaultValue;
    if (defaultValue != undefined) {
        if (!/^0x[0-9a-fA-F]+$/.test(defaultValue)) {
            if (defaultValue == "''" || defaultValue == '""') {
                defaultValue = "''";
            } else {
                throw new Error(`Invalid default value for binary column "${defaultValue}"`);
            }
        }
    }

    let nullable = col.nullable;

    return sprintf("%sBINARY(%d) %s %s",
        minimumSize === maximumSize ? "" : "VAR",
        maximumSize,
        nullable ? "NULL" : "NOT NULL",
        defaultValue != undefined ? ("DEFAULT " + defaultValue) : ""
    );
}

function processBooleanColumn(col) {
    let defaultValue = col.defaultValue;
    if (defaultValue != undefined) {
        if (defaultValue !== 0 && defaultValue !== 1) {
            throw new TypeError(`Boolean column has invalid default value "${defaultValue}"`);
        }
    }

    let nullable = col.nullable;

    return sprintf("TINYINT(1) UNSIGNED %s %s",
        nullable ? "NULL" : "NOT NULL",
        defaultValue != undefined ? ("DEFAULT " + defaultValue) : ""
    );
}

function processCodeColumn(col) {
    if (!col.values.length) {
        throw new Error(`Code column has no values`);
    }

    let valueCodes = new Set();
    let valueNames = new Set();
    let highestCode = 0;
    col.values.forEach(val => {
        let code = val.code;
        let name = val.value;

        if (!Number.isSafeInteger(code) || code < 0) {
            throw new TypeError(`Code column has invalid value code "${code}"`);
        }

        if (!/^[A-Z0-9_]+$/.test(name)) {
            throw new Error(`Code column has invalid value name "${name}"`);
        }

        if (valueCodes.has(code)) {
            throw new ReferenceError(`Code column contains duplicate value code "${code}"`);
        }

        if (valueNames.has(name)) {
            throw new ReferenceError(`Code column contains duplicate value name "${name}"`);
        }

        valueCodes.add(code);
        valueNames.add(name);

        if (code > highestCode) {
            highestCode = code;
        }
    });

    if (highestCode > 255) {
        throw new RangeError(`Code column contains too large value code "${highestCode}"`);
    }

    let defaultValue = col.defaultValue;
    if (defaultValue != undefined) {
        if (!valueCodes.has(defaultValue)) {
            throw new ReferenceError(`Code column has unknown default value "${defaultValue}"`);
        }
    }

    let nullable = col.nullable;

    return sprintf("TINYINT UNSIGNED %s %s",
        nullable ? "NULL" : "NOT NULL",
        defaultValue != undefined ? ("DEFAULT " + defaultValue) : ""
    );
}

function processTable(table, database, databases) {
    let name = table.name;
    let type = table.type;
    let indexes = table.indexes;

    if (!/^[a-z_]+$/.test(name)) {
        throw new Error(`Invalid table name "${name}"`);
    }
    if (type != "fixed") {
        throw new TypeError(`Non-fixed tables are not supported yet`);
    }

    let tableSqlCols = [];

    let tableSqlIdxes = [];

    indexes.forEach(idx => {
            switch (idx.type) {
                case "primary":
                    tableSqlIdxes.push(`PRIMARY KEY (${idx.columns.join(',')})`);
                    break;

                case "unique":
                    tableSqlIdxes.push(`UNIQUE (${idx.columns.join(',')})`);
                    break;

                case "index":
                    tableSqlIdxes.push(`INDEX (${idx.columns.join(',')})`);
                    break;

                default:
                    throw new Error(`Unrecognised index type "${idx.type}"`);

            }
        }
    );

    table.columns.forEach(col => {
        let colName = col.name;
        if (!/^[a-z][a-zA-Z0-9]+$/.test(colName)) {
            throw new Error(`Invalid table column name "${colName}" in table "${name}"`);
        }

        let colSqlDesc;

        switch (col.type) {
            case "FK":
                let targetParts = col.column.split('.');

                let targetCol = targetParts.pop();
                if (!targetCol) {
                    throw new ReferenceError(`No column provided for FK reference column`);
                }

                let targetTable = targetParts.pop();
                if (!targetTable) {
                    throw new ReferenceError(`No table provided for FK reference column`);
                }

                let targetDatabase = targetParts.pop();
                if (targetDatabase == undefined) {
                    targetDatabase = database;
                } else {
                    targetDatabase = databases.find(db => db.name === targetDatabase);
                    if (!targetDatabase) {
                        throw new ReferenceError(`Non-existent database provided for FK reference column`);
                    }
                }

                targetTable = targetDatabase.tables.find(t => t.name === targetTable);
                if (!targetTable) {
                    throw new ReferenceError(`Non-existent table provided for FK reference column`);
                }

                targetCol = targetTable.columns.find(c => c.name === targetCol);
                if (!targetCol) {
                    throw new ReferenceError(`Non-existent column provided for FK reference column`);
                }

                if (targetCol.nullable) {
                    throw new TypeError(`FK reference column is nullable, not suitable for FK reference`);
                }

                switch (targetCol.type) {
                    case "integer":
                        colSqlDesc = processIntegerColumn(targetCol).replace("AUTO_INCREMENT", "").replace(/DEFAULT .*$/, "");
                        break;

                    case "serial":
                        colSqlDesc = processSerialColumn(targetCol).replace("AUTO_INCREMENT", "").replace(/DEFAULT .*$/, "");
                        break;

                    default:
                        throw new TypeError(`FK reference column has type not suitable as FK reference`);
                }

                if (col.ondelete != undefined && col.ondelete != "NO ACTION") {
                    tableSqlIdxes.push(`FOREIGN KEY (${colName}) REFERENCES ${targetDatabase == database ? "" : (targetDatabase.name + ".")}${targetTable.name} (${targetCol.name}) ON DELETE ${col.ondelete}`);
                }

                if (col.nullable) {
                    colSqlDesc = colSqlDesc.replace('NOT NULL', 'NULL');
                }

                if (col.defaultValue != undefined) {
                    if (!Number.isSafeInteger(col.defaultValue)) {
                        throw new TypeError(`Invalid FK default value`);
                    }
                    colSqlDesc += ` DEFAULT ${col.defaultValue}`;
                }

                break;

            case "integer":
                colSqlDesc = processIntegerColumn(col);
                break;

            case "serial":
                colSqlDesc = processSerialColumn(col);
                break;

            case "timestamp":
                colSqlDesc = processTimestampColumn(col);
                break;

            case "string":
                colSqlDesc = processStringColumn(col);
                break;

            case "binary":
                colSqlDesc = processBinaryColumn(col);
                break;

            case "boolean":
                colSqlDesc = processBooleanColumn(col);
                break;

            case "code":
                colSqlDesc = processCodeColumn(col);
                break;

            default:
                throw new TypeError(`Unknown table column type "${col.type}" for column "${colName}" in table "${name}"`);
        }

        tableSqlCols.push(`${colName} ${colSqlDesc}`);
    });

    return `
        CREATE TABLE ${name} (
            ${tableSqlCols.concat(tableSqlIdxes).join(',\n')}
        );
    `;
}

fs.readdirSync(IN_DIR).filter(f => /\.json$/.test(f)).map(f => f.slice(0, -5)).forEach(f => {
    let databases = JSON.parse(fs.readFileSync(`${IN_DIR}/${f}.json`, 'utf8'));

    databases.forEach(db => {
        let dbSql = `
            CREATE DATABASE ${db.name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            USE ${db.name};
        `;
        db.tables.forEach(table => {
            dbSql += processTable(table, db, databases);
        });
        fs.outputFileSync(`${OUT_DIR}/${f}.sql`, dbSql);
    });
});

