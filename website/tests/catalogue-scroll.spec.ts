import { expect, test, type Page } from '@playwright/test';
import { families, catalogueEntries, catalogueHref, familyOptions } from '../src/tools-data';
async function ready(page:Page){await page.goto('/');await expect(page.locator('.desktop-file')).toHaveCount(7);}
test('scene and docking are identical at matching positions in both directions across viewports',async({page})=>{
  test.setTimeout(60000);await ready(page);
  for(const viewport of [{width:1440,height:1000},{width:1366,height:768},{width:768,height:1024},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    const pair=await page.evaluate(async()=>{
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const story=document.querySelector<HTMLElement>('.orchard-story')!,stage=document.querySelector<HTMLElement>('.orchard-stage')!,fruit=document.querySelector<SVGSVGElement>('[data-continuous-fruit]')!,anchor=document.querySelector('[data-wheel-anchor]')!;
      const rind=fruit.querySelector('.citrus-rind')!,start=story.getBoundingClientRect().top+scrollY,track=story.offsetHeight-stage.offsetHeight,end=start+track,slot=anchor.getBoundingClientRect();
      const dockAt=Math.max(end+1,scrollY+slot.top+slot.height/2-(stage.clientHeight-slot.width/2+(stage.clientWidth<=760?40:-28)));
      const positions=[0,...[.19,.36,.38,.40,.45,.62,.77,.90,.96,.99].map(p=>start+track*p),end+1,end+(dockAt-end)*.25,end+(dockAt-end)*.5,end+(dockAt-end)*.9,dockAt+1,dockAt+80];
      async function sample(y:number){scrollTo({top:y,behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=fruit.getBoundingClientRect();return {scroll:scrollY,box:[b.x,b.y,b.width,b.height],docked:fruit.dataset.docked,geometry:fruit.style.getPropertyValue('--geometry'),mask:fruit.querySelector('[data-skin-mask]')!.getAttribute('width'),core:fruit.querySelector('.citrus-core')!.getAttribute('r'),paths:Array.from(fruit.querySelectorAll('[data-sector]')).map(p=>p.getAttribute('d')),fill:getComputedStyle(fruit.querySelector('[data-sector]')!).fill,camera:document.querySelector('[data-camera]')!.getAttribute('transform'),arrow:document.querySelector('[data-arrow]')!.getAttribute('transform'),context:stage.style.getPropertyValue('--context-opacity'),sameRind:fruit.querySelector('.citrus-rind')===rind};}
      const forward=[];for(const y of positions)forward.push(await sample(y));const reverse=[];for(const y of [...positions].reverse())reverse.push(await sample(y));return {forward,reverse:reverse.reverse()};
    });
    for(let i=0;i<pair.forward.length;i++){expect(pair.reverse[i],`${viewport.width}×${viewport.height}, sample ${i}`).toEqual(pair.forward[i]);expect(pair.forward[i].sameRind).toBe(true);expect(pair.forward[i].box[2]).toBeCloseTo(pair.forward[i].box[3],2);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
  }
});
test('output growth does not move the wheel anchor or change its docking threshold',async({page})=>{
  await ready(page);await page.locator('[data-wheel-anchor]').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await expect(page.locator('[data-continuous-fruit]')).toHaveAttribute('data-docked','true');
  const anchor=()=>page.locator('[data-wheel-anchor]').evaluate(el=>({top:el.getBoundingClientRect().top+scrollY,width:el.getBoundingClientRect().width}));const before=await anchor();
  await page.getByRole('button',{name:'Run action',exact:true}).click();await expect(page.locator('.output-card a')).toBeVisible();expect(await anchor()).toEqual(before);await page.evaluate(()=>scrollBy({top:-25,behavior:'instant'}));await expect(page.locator('[data-continuous-fruit]')).toHaveAttribute('data-docked','true');
});
test('showcase covers the full source catalogue, with unique scoped entries and explicit visibility',async({page})=>{
  const entries=families.flatMap(catalogueEntries);expect(new Set(families.map(f=>f.id)).size).toBe(families.length);expect(new Set(entries.map(e=>e.key)).size).toBe(entries.length);for(const {option} of entries){expect(option.label.trim()).not.toBe('');expect(option.detail.trim()).not.toBe('');}
  const audio=families.find(f=>f.id==='audio')!;expect(audio.tools.every(o=>o.availability==='concept')).toBe(true);expect(familyOptions(audio,'tools',{includeConcepts:false})).toEqual([]);
  await page.goto('/');await expect(page.locator('.catalogue-card')).toHaveCount(families.length);await expect(page.locator('[data-catalogue-entry]')).toHaveCount(entries.length);
  for(const family of families){const card=page.locator(`.catalogue-card[data-family="${family.id}"]`);await expect(card.locator('h3')).toHaveText(family.name);await expect(card.locator('.catalogue-note')).toHaveText(family.note);await expect(card.locator('[data-catalogue-entry]')).toHaveCount(catalogueEntries(family).length);}
  const links=await page.locator('[data-catalogue-entry] > a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));expect(links).toEqual(entries.map(e=>catalogueHref(e.family,e.mode,e.option)));
  await expect(page.getByRole('link',{name:'See all tools',exact:true})).toHaveAttribute('href','/tools');
  for(const status of ['bundled','conditional','disabled'] as const){const label=status==='bundled'?'Built in':status==='conditional'?'Engine dependent':'Not enabled';await page.locator('.catalogue-filters').getByRole('button',{name:new RegExp(`^${label}`)}).click();await expect(page.locator('.catalogue-card')).toHaveCount(families.filter(f=>f.status===status).length);}
  await page.locator('.catalogue-filters').getByRole('button',{name:/^All families/}).click();await expect(page.locator('[data-catalogue-entry]')).toHaveCount(entries.length);
});
test('catalogue links open the correct stable source-backed tools preview, including concepts and disabled scope',async({page})=>{
  for(const [id,mode,label] of [['images','tools','Crop'],['images','tools','Edit metadata'],['video','tools','Delete metadata'],['audio','tools','Normalize'],['documents','convert','EPUB'],['pdf','tools','Merge PDFs']] as const){
    const family=families.find(f=>f.id===id)!,option=familyOptions(family,mode).find(o=>o.label===label)!;await page.goto(catalogueHref(family,mode,option));await expect(page.locator('.family-index-item[aria-pressed=true]')).toContainText(family.name);await expect(page.locator('.desk-selected h4')).toHaveText(label);await expect(page.getByRole('switch',{name:'Autoplay tool tour'})).toHaveAttribute('aria-checked','false');if(option.availability==='concept')await expect(page.locator('.desk-concept-note')).toBeVisible();if(option.backend){await expect(page.locator('.desk-selected small')).toHaveText(option.backend);await expect(page.locator('.desk-state')).toHaveText('ENGINE DEPENDENT');}
  }
  await page.locator('.desk-operation-list').getByRole('button',{name:'04 Rotate pages'}).click();await expect(page).toHaveURL(/action=Rotate\+pages/);await page.reload();await expect(page.locator('.desk-selected h4')).toHaveText('Rotate pages');
  await page.goto(catalogueHref(families.find(f=>f.id==='spreadsheets')!));await expect(page.locator('.desk-empty')).toContainText('paused');await expect(page.locator('.desk-operation')).toHaveCount(0);
  await page.goto('/tools');await expect(page.getByRole('heading',{name:'Try the thought process.'})).toBeVisible();
});
test('wheel uses all supported source options with overflow, while excluding audio editor concepts',async({page})=>{
  await ready(page);await page.locator('[data-wheel-anchor]').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await page.getByRole('button',{name:'Select creative-brief.pdf',exact:true}).click();await expect(page.locator('.wheel-pagination')).toContainText('of 7');await page.getByRole('button',{name:'Next actions',exact:true}).click();await expect(page.locator('[data-continuous-fruit]').getByRole('button',{name:'Render page',exact:true})).toBeVisible();await expect(page.locator('.unavailable-action')).toBeVisible();
  await page.getByRole('button',{name:'Select field-notes.md',exact:true}).click();await expect(page.locator('[data-continuous-fruit]').getByRole('button')).toHaveText(families.find(f=>f.id==='documents')!.outputs.map(o=>o.label));
  await page.getByRole('button',{name:'Select orchard-tone.wav',exact:true}).click();await expect(page.locator('.wheel-pagination')).toContainText('of 8');await page.getByRole('button',{name:'Next actions',exact:true}).click();await expect(page.locator('[data-continuous-fruit]').getByRole('button')).toHaveText(['AIFF','WMA']);await page.locator('.wheel-tabs').getByRole('button',{name:'Tools',exact:true}).click();await expect(page.locator('[data-continuous-fruit]').getByRole('button')).toHaveCount(0);await expect(page.locator('.no-actions')).toBeVisible();
});
test('complete catalogue remains readable at phone and tablet widths, and cleans up on route changes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [390,768]){await page.setViewportSize({width,height:844});await page.goto('/');await page.locator('.catalogue-card[data-family="audio"] summary').click();await expect(page.locator('.catalogue-card[data-family="audio"] [data-catalogue-entry]')).toHaveCount(15);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await page.locator('.catalogue-card[data-family="audio"] [data-catalogue-entry] a').filter({hasText:'Bleep'}).click();await expect(page.locator('.desk-selected h4')).toHaveText('Bleep');await page.getByRole('link',{name:'Santra home',exact:true}).click();await expect(page.locator('.citrus-rind')).toHaveCount(1);}
  expect(errors).toEqual([]);
});
