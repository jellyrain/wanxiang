import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdown,markdownInline,markdownUrl} from '../src/shared/markdown.ts';
const tags=nodes=>nodes.flatMap(n=>[n.tag,...tags(n.children??[])]);
test('Markdown 标题、强调、引用、分隔线和原文换行',()=>{
 const nodes=parseMarkdown('# 标题\n\n**粗体**、*斜体*、~~删除~~、`代码`\n保留换行\n\n> 引用\n> 第二行\n\n---');
 for(const tag of ['h1','strong','em','del','code','blockquote','hr'])assert.ok(tags(nodes).includes(tag),tag);
 assert.ok(JSON.stringify(nodes).includes('保留换行'));
 assert.deepEqual(parseMarkdown('普通正文\n第二行')[0].children,[{tag:'text',text:'普通正文\n第二行'}]);
});
test('有序、无序、嵌套和任务列表，以及表格对齐',()=>{
 const nodes=parseMarkdown('3. 第一项\n   - 子项\n4. 第二项\n\n- [x] 完成\n- [ ] 待办\n\n| 人物 | 状态 |\n| :--- | ---: |\n| 张三 | **出场** |');
 assert.equal(nodes[0].tag,'ol');assert.equal(nodes[0].start,3);assert.ok(tags(nodes[0].children).includes('ul'));
 assert.equal(nodes[1].children[0].checked,true);assert.equal(nodes[1].children[1].checked,false);
 const table=nodes[2];assert.equal(table.tag,'table');assert.equal(table.children[0].children[0].children[1].align,'right');assert.ok(tags([table]).includes('strong'));
});
test('围栏与缩进代码保持原文，未闭合围栏不丢内容',()=>{
 const body='# 不渲染\n<script>alert(1)</script>\n**原样**';
 assert.equal(parseMarkdown('```js\n'+body+'\n```')[0].children[0].text,body);
 assert.equal(parseMarkdown('~~~\n'+body)[0].children[0].text,body);
 assert.equal(parseMarkdown('    代码\n    第二行')[0].children[0].text,'代码\n第二行');
});
test('链接只允许显式安全协议，HTML 与图片保持不可执行',()=>{
 for(const value of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,test','file:///C:/secret','//example.com','java\nscript:alert(1)','vbscript:x'])assert.equal(markdownUrl(value),undefined,value);
 assert.equal(markdownUrl('https://example.com/a'),'https://example.com/a');
 const input='<script>alert(1)</script><img src=x onerror=alert(1)>';
 assert.deepEqual(markdownInline(input),[{tag:'text',text:input}]);
 const nodes=markdownInline('[危险](javascript:alert(1)) ![图片](https://example.com/x.png)');assert.ok(!tags(nodes).includes('img'));assert.ok(!JSON.stringify(nodes).includes('javascript:'));
});
test('转义、代码内竖线、反斜杠转义竖线及中英文强调',()=>{
 assert.equal(markdownInline('\\*原样\\*')[0].text,'*原样*');
 assert.equal(markdownInline('***重点***')[0].tag,'strong');
 assert.equal(markdownInline('word_with_underscore')[0].text,'word_with_underscore');
 const table=parseMarkdown('| 文本 | 代码 |\n| --- | --- |\n| A\\|B | `x|y` |')[0];
 assert.equal(table.children[1].children[0].children.length,2);
});
test('大段中文与嵌套深度限制不会丢失内容',()=>{
 const source='这是一段三十万字符的正文。'.repeat(20000);const before=performance.now();
 assert.equal(parseMarkdown(source)[0].children[0].text,source);assert.ok(performance.now()-before<5000);
 assert.doesNotThrow(()=>parseMarkdown('> '.repeat(100)+'深层内容'));
});
