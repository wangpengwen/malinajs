
module.exports = {
    buildRuntime
};

const {assert} = require('./parser');
const { get } = require('https');

let uniqIndex = 0;
let buildBlock;

function buildRuntime(data) {
    let runtime = [`
        function $$apply() {
            if($$apply.planned) return;
            $$apply.planned = true;
            setTimeout(() => {
                $$apply.planned = false;
                $$apply.go();
            }, 1);
        };
        (function() {
            function $$CD() {
                this.children = [];
                this.watchers = [];
                this.destroyList = [];
            };
            $$CD.prototype.watch = function(fn, callback, mode) {
                this.watchers.push({fn: fn, cb: callback, value: undefined, ro: mode == 'ro'});
            };
            $$CD.prototype.wf = function(fn, callback) {
                this.watch(fn, callback, 'ro');
            }
            $$CD.prototype.wa = function(fn, callback) {
                this.watchers.push({fn: fn, cb: callback, value: undefined, a: true})
            }
            $$CD.prototype.ev = function(el, event, callback) {
                el.addEventListener(event, callback);
                this.d(() => {
                    el.removeEventListener(event, callback);
                });
            }
            $$CD.prototype.d = function(fn) {
                this.destroyList.push(fn);
            }
            $$CD.prototype.destroy = function() {
                this.destroyList.forEach(fn => {
                    try {
                        fn();
                    } catch (e) {
                        console.error(e);
                    }
                });
                this.destroyList.length = 0;
                this.children.forEach(cd => {
                    cd.destroy();
                });
                this.children.length = 0;
            }

            let $cd = new $$CD();

            const arrayCompare = (a, b) => {
                let e0 = a == null || !a.length;
                let e1 = b == null || !b.length;
                if(e0 !== e1) return true;
                if(e0 === true) return false;
                if(a.length !== b.length) return true;
                for(let i=0;i<a.length;i++) {
                    if(a[i] !== b[i]) return true;
                }
                return false;
            };
            $$apply.go = () => {
                let loop = 10;
                while(loop >= 0) {
                    let changes = 0;
                    let cd;
                    for(let cdIndex=-1;cdIndex<$cd.children.length;cdIndex++) {
                        if(cdIndex == -1) cd = $cd;
                        else cd = $cd.children[cdIndex];
                        cd.watchers.forEach((w) => {
                            let value = w.fn();
                            if(w.a) {
                                if(arrayCompare(w.value, value)) {
                                    w.value = value.slice();
                                    if(!w.ro) changes++;
                                    w.cb(w.value);
                                }
                            } else {
                                if(w.value !== value) {
                                    w.value = value;
                                    if(!w.ro) changes++;
                                    w.cb(w.value);
                                }
                            }
                        });
                    }
                    loop--;
                    if(!changes) break;
                }
            };

    `];

    buildBlock = function(data, option = {}) {
        let tpl = [];
        let lvl = [];
        let binds = [];
        let elements = {};

        function go(level, data) {
            let index = 0;
            const setLvl = () => {lvl[level] = index++;}
            const getElementName = () => {
                let el = '$element';
                if(option.top0) lvl.slice(1).forEach(n => el += `.childNodes[${n}]`);
                else lvl.forEach(n => el += `.childNodes[${n}]`);
                let name = elements[el];
                if(!name) {
                    elements[el] = name = 'el' + (uniqIndex++);
                    binds.push(`var ${name} = ${el};`);
                }
                return name;
            };

            data.body.forEach(n => {
                if(n.type === 'text') {
                    setLvl();
                    if(n.value.indexOf('{') >= 0) {
                        tpl.push(' ');
                        let exp = parseText(n.value);
                        binds.push(`$cd.wf(() => ${exp}, (value) => {${getElementName()}.textContent=value;});`);
                    } else tpl.push(n.value);
                } else if(n.type === 'script') {
                    return
                } else if(n.type === 'node') {
                    setLvl();
                    if(n.openTag.indexOf('{') >= 0) {
                        let r = parseElement(n.openTag);
                        let el = ['<' + n.name];
                        r.forEach(p => {
                            if(!p.value || p.value[0] != '{') {
                                el.push(p.content);
                            } else {
                                binds.push(makeBind(p, getElementName()));
                            }
                        });
                        if(n.closedTag) el.push('/>');
                        else el.push('>');
                        tpl.push(el.join(' '));
                    } else tpl.push(n.openTag);
                    if(!n.closedTag) {
                        go(level + 1, n);
                        tpl.push(`</${n.name}>`);
                    }
                } else if(n.type === 'each') {
                    setLvl();
                    tpl.push(`<!-- ${n.value} -->`);
                    let eachBlock = makeEachBlock(n, getElementName());
                    binds.push(eachBlock.source);
                } else if(n.type === 'if') {
                }
            });

            lvl.length = level;
        };
        go(0, data);

        let source = [];

        let buildName = '$$build' + (uniqIndex++);
        tpl = Q(tpl.join(''));
        source.push(`
            function ${buildName}($cd, $element) {
        `);
        source.push(binds.join('\n'));
        source.push(`    };`);

        return {
            name: buildName,
            tpl: tpl,
            source: source.join('')
        }

    };

    let bb = buildBlock(data);
    runtime.push(bb.source);
    runtime.push(`
        $element.innerHTML = \`${Q(bb.tpl)}\`;
        ${bb.name}($cd, $element);
    `);

    runtime.push(`\n})();`);
    return runtime.join('');
}


function Q(s) {
    return s.replace(/`/g, '\\`');
};


function parseText (source) {
    let i = 0;
    let step = 0;
    let text = '';
    let exp = '';
    let result = [];
    let q;
    while(i < source.length) {
        let a = source[i++];
        if(step == 1) {
            if(q) {
                if(a === q) q = null;
                exp += a;
                continue;
            }
            if(a === '"' || a === "'") {
                q = a;
                exp += a;
                continue;
            }
            if(a === '}') {
                step = 0;
                result.push(exp);
                exp = '';
                continue;
            }
            exp += a;
            continue;
        }
        if(a === '{') {
            if(text) {
                result.push('`' + Q(text) + '`');
                text = '';
            }
            step = 1;
            continue;
        }
        text += a;
    }
    if(text) result.push('`' + Q(text) + '`');
    assert(step == 0, 'Wrong expression: ' + source);
    return result.join('+');
};


function parseElement(source) {
    // TODO: parse '/>' at the end
    let len = source.length - 1;
    assert(source[0] === '<');
    assert(source[len] === '>');
    if(source[len - 1] == '/') len--;

    let index = 1;
    let start = 1;
    let eq;
    let result = [];
    let first = true;

    const next = () => {
        assert(index < source.length, 'EOF');
        return source[index++];
    }
    const flush = (shift) => {
        if(index <= start) return;
        if(first) {
            first = false;
            return;
        }
        let prop = {
            content: source.substring(start, index + shift)
        }
        if(eq) {
            prop.name = source.substring(start, eq - 1);
            prop.value = source.substring(eq, index + shift);
            eq = null;
        }
        result.push(prop);
    };

    let bind = false;

    while(index < len) {
        let a = next();

        if(a === '"' || a === "'") {
            while(a != next());
            continue;
        }

        if(bind) {
            bind = a != '}';
            continue;
        }

        if(a == '{') {
            bind = true;
            continue;
        }

        if(a == ' ') {
            flush(-1);
            start = index;
            continue;
        }
        if(a == '=' && !eq) {
            eq = index;
        }
    }
    flush(0);
    return result;
};


function makeBind(prop, el) {
    let d = prop.name.split(':');
    let name = d[0];
    
    let exp = prop.value.match(/^\{(.*)\}$/)[1];
    assert(exp, prop.content);

    if(name == 'on') {
        let mod = '', opt = d[1].split('|');
        event = opt[0];
        if(opt[1] === 'preventDefault') mod = `$event.preventDefault();`;
        assert(event, prop.content);
        return `$cd.ev(${el}, "${event}", ($event) => { ${mod} $$apply(); ${Q(exp)}});`;
    } else if(name == 'bind') {
        let attr = d[1];
        assert(attr, prop.content);
        if(attr === 'value') {
            return `$cd.ev(${el}, 'input', () => { ${exp}=${el}.value; $$apply(); });
                    $cd.wf(() => (${exp}), (value) => { if(value != ${el}.value) ${el}.value = value; });`;
        } else if(attr == 'checked') {
            return `$cd.ev(${el}, 'input', () => { ${exp}=${el}.checked; $$apply(); });
                    $cd.wf(() => !!(${exp}), (value) => { if(value != ${el}.checked) ${el}.checked = value; });`;
        } else throw 'Not supported: ' + prop.content;
    } else if(name == 'class') {
        let className = d[1];
        assert(className, prop.content);
        return `$cd.wf(() => !!(${exp}), (value) => { if(value) ${el}.classList.add("${className}"); else ${el}.classList.remove("${className}"); });`;
    } else throw 'Wrong binding: ' + prop.content;
};


function makeEachBlock(data, topElementName) {
    let source = [];

    let nodeItems = data.body.filter(n => n.type == 'node');
    assert(nodeItems.length === 1, 'Only 1 node for #each');
    itemData = buildBlock({body: nodeItems}, {top0: true});

    let rx = data.value.match(/^#each\s+(\S+)\s+as\s+(\w+)\s*$/);
    let arrayName = rx[1];
    let itemName = rx[2];

    let eachBlockName = 'eachBlock' + (uniqIndex++);
    source.push(`
        function ${eachBlockName} ($cd, top) {
            let srcNode = document.createElement("div");
            srcNode.innerHTML=\`${Q(itemData.tpl)}\`;
            srcNode=srcNode.firstChild;

            let mapping = new Map();
            $cd.wa(() => (${arrayName}), (array) => {
                let prevNode = top;
                let newMapping = new Map();

                if(mapping.size) {
                    let arrayAsSet = new Set();
                    for(let i=0;i<array.length;i++) {
                        arrayAsSet.add(array[i]);
                    }
                    mapping.forEach((ctx, item) => {
                        if(arrayAsSet.has(item)) return;
                        ctx.el.remove();
                        ctx.cd.destroy();
                        let i = $cd.children.indexOf(ctx.cd);
                        i>=0 && $cd.children.splice(i, 1);
                    });
                    arrayAsSet.clear();
                }

                array.forEach(${itemName} => {
                    ${itemData.source};
                    let el, ctx = mapping.get(todo);
                    if(ctx) {
                        el = ctx.el;
                    } else {
                        el = srcNode.cloneNode(true);
                        let childCD = new $$CD(); $cd.children.push(childCD);
                        ctx = {el: el, cd: childCD};
                        ${itemData.name}(childCD, el);
                    }
                    if(el.previousSibling != prevNode) {
                        if(el.previousSibling) el.previousSibling.remove();
                        if(el.previousSibling != prevNode) top.parentNode.insertBefore(el, prevNode.nextSibling);
                    }
                    prevNode = el;
                    newMapping.set(todo, ctx);


                });
                mapping.clear();
                mapping = newMapping;

            });

        }
        ${eachBlockName}($cd, ${topElementName});
    `);

    return {
        source: source.join('\n')
    }
};
