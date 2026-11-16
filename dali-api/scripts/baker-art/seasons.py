import re, random, sys
src=open('variants.py').read()
i=src.index("W={")+2; d=0
for j in range(i,len(src)):
  if src[j]=='{': d+=1
  elif src[j]=='}':
    d-=1
    if d==0: break
W=eval(src[i:j+1])
def hexmap(s,m):
  m={k.upper():v for k,v in m.items() if k.startswith('#')}
  return re.sub(r'#[0-9A-Fa-f]{6}', lambda x: m.get(x.group(0).upper(), x.group(0)), s)
def strmap(s,m):
  for k,v in m.items():
    if not k.startswith('#'): s=s.replace(k,v)
  return s
SP={'#F7A64A':'#F8C6DA','#FBC27E':'#FCE0EB','#E08A2C':'#EBA6C3','#E8862A':'#F2A7C6','#F2A55A':'#F8C4DA','#C66B18':'#DB86AA','#C2611A':'#D9839F','#D27A34':'#E69DB5','#9E4C12':'#B9667F',
 '#F9CF5E':'#B6DC7E','#FCE08F':'#CCE8A2','#E5B73E':'#9AC761','#F2B53B':'#9CCB62','#F7CD6E':'#B4DA82','#D4972A':'#7FB049','#CF9324':'#77A845','#DDAA45':'#8EBE5B','#A9741A':'#5C8A33',
 '#E8714A':'#FFFDF8','#F29171':'#FFFFFB','#CB5530':'#F1E9DA','#D8572A':'#F5EEE2','#E9774F':'#FFFBF4','#B4431D':'#DED3BF','#A9401E':'#D8CCB6','#BC5634':'#E6DCC8','#852F14':'#B8AB92',
 '#25492F':'#2F6A3D','#2F5A3B':'#3B7B4A','#1A3824':'#245A30','#8DB04A':'#86C45A','#A9C0D4':'#9CC8EC','#4C7A3C':'#5E9A48','#78B552':'#86C45A','#3F7A4E':'#4E8E52','#4F8E5E':'#62A266','#30613D':'#3B7243'}
SU={'#F7A64A':'#6FB255','#FBC27E':'#88C66E','#E08A2C':'#579A40','#E8862A':'#5A9C45','#F2A55A':'#72B25C','#C66B18':'#457E34','#C2611A':'#447D35','#D27A34':'#5A9447','#9E4C12':'#33622A',
 '#F9CF5E':'#8CC45E','#FCE08F':'#A5D57C','#E5B73E':'#72AA48','#F2B53B':'#76B04C','#F7CD6E':'#8FC466','#D4972A':'#5E923A','#CF9324':'#5C9139','#DDAA45':'#72A84D','#A9741A':'#46722B',
 '#E8714A':'#5E9F57','#F29171':'#79B472','#CB5530':'#4A8645','#D8572A':'#4E8C49','#E9774F':'#66A360','#B4431D':'#3B7038','#A9401E':'#3B6E37','#BC5634':'#4F844A','#852F14':'#2C5429',
 '#25492F':'#3A7A3A','#2F5A3B':'#4A8A48','#1A3824':'#2C5C2E','#8DB04A':'#6DB047','#A9C0D4':'#7FB2E8','#DCE3E6':'#D7E7F2','#4C7A3C':'#4A8238','#78B552':'#6DB047'}

ALIAS={'#E3B988':'#F7A64A','#EDCBA2':'#FBC27E','#CFA06E':'#E08A2C','#D4A472':'#E8862A','#E0B88C':'#F2A55A','#BC8C5A':'#C66B18','#B88A5C':'#C2611A','#C89C72':'#D27A34','#A07448':'#9E4C12',
 '#CFCB8C':'#F9CF5E','#DAD7A0':'#FCE08F','#BDB874':'#E5B73E','#CCC88A':'#F7CD6E','#A8A460':'#D4972A','#9A9660':'#CF9324','#AAA672':'#DDAA45','#85814E':'#A9741A',
 '#D9A090':'#E8714A','#E5B4A4':'#F29171','#C48A7A':'#CB5530','#D49C8C':'#E9774F','#AE7466':'#B4431D','#9C6458':'#C2611A','#AE776B':'#D27A34','#865046':'#9E4C12','#E39A2A':'#F7A64A','#EFB04A':'#FBC27E','#C8741E':'#E8862A','#DA8A38':'#F2A55A','#A85C14':'#C66B18','#8E4E14':'#C2611A','#A26226':'#D27A34','#6E3A0C':'#9E4C12',
 '#F0C040':'#F9CF5E','#F8D468':'#FCE08F','#E6A826':'#E5B73E','#F0BC48':'#F7CD6E','#C48A1A':'#D4972A','#A8760E':'#CF9324','#BC8A22':'#DDAA45','#86580A':'#A9741A','#B8631F':'#E8862A','#CC7A38':'#F2A55A','#9A4E14':'#C66B18','#7A4A1C':'#C2611A','#8E5E2E':'#D27A34','#5E3410':'#9E4C12',
 '#D9A040':'#F9CF5E','#E8B858':'#FCE08F','#C08A28':'#E5B73E','#C98A2A':'#F2B53B','#DAA044':'#F7CD6E','#A87020':'#D4972A','#6A5A1A':'#CF9324','#7E6E2C':'#DDAA45','#4E4210':'#A9741A','#D9822B':'#E8862A','#E69A48':'#F2A55A','#C06A1C':'#C66B18','#B8452A':'#D8572A','#CC5E40':'#E9774F','#9A3418':'#B4431D','#AE4A2C':'#BC5634','#702410':'#852F14','#C8782A':'#E8862A','#D88E40':'#F2A55A','#A85E1C':'#C66B18','#D99A3A':'#F2B53B','#E8AE52':'#F7CD6E','#B8802A':'#D4972A',
 '#B0502A':'#D8572A','#C4663E':'#E9774F','#8E3C1C':'#B4431D','#E0B040':'#F9CF5E','#EEC45A':'#FCE08F','#C09030':'#E5B73E','#B85A2A':'#E8714A','#CC7240':'#F29171','#A04A22':'#CB5530','#B66030':'#D8572A','#843A18':'#B4431D','#984C26':'#BC5634','#5E2A10':'#852F14',
 '#E08A3A':'#F7A64A','#EEA458':'#FBC27E','#D07A2A':'#E08A2C','#E0944A':'#F2A55A','#B0601C':'#C66B18','#C4782E':'#D27A34','#7E4010':'#9E4C12',
 '#DCAA3A':'#F9CF5E','#EAC060':'#FCE08F','#C8962E':'#E5B73E','#DAAE48':'#F7CD6E','#A87A20':'#D4972A','#BC9030':'#DDAA45','#7E5A12':'#A9741A',
 '#E4BC3C':'#F9CF5E','#F0D060':'#FCE08F','#D4A62A':'#E5B73E','#E4BC44':'#F7CD6E','#B08818':'#D4972A','#C49E28':'#DDAA45','#8A6A10':'#A9741A',
 '#D6C44A':'#F9CF5E','#E4D468':'#FCE08F','#C9B03A':'#E5B73E','#D8C456':'#F7CD6E','#A8922A':'#D4972A','#BCA63A':'#DDAA45','#7E6E18':'#A9741A',
 '#9A6A2E':'#E08A2C','#AA7A3E':'#F2A55A','#7E5420':'#C66B18','#B08A3A':'#E5B73E','#C09A4A':'#F7CD6E','#8E6E2A':'#D4972A','#E0A82A':'#F9CF5E','#EEC060':'#FCE08F','#C48A1E':'#E5B73E','#D49E3A':'#F7CD6E','#A87414':'#D4972A','#BC8828':'#DDAA45','#8A5C0E':'#A9741A',
 '#D8783A':'#E8714A','#E69258':'#F29171','#C66A2E':'#CB5530','#D8803F':'#E9774F','#A04E22':'#B4431D','#B46036':'#BC5634','#7E3A16':'#852F14',
'#D9962E':'#F7A64A','#E8B056':'#FBC27E','#B8741F':'#E8862A','#CC8D3A':'#F2A55A','#9E6426':'#C66B18','#8A5A24':'#C2611A','#9E6E36':'#D27A34','#55371D':'#9E4C12',
 '#C04A20':'#E8714A','#D2623A':'#F29171','#A02A20':'#CB5530','#A83A20':'#D8572A','#BC5232':'#E9774F','#8A2418':'#B4431D','#7E2418':'#CB5530','#92382A':'#F29171','#5E1A12':'#B4431D'}
GREENS={'#8E9C42':'#9CC25A','#A3B05A':'#B5D47E','#7A8A3A':'#82A843','#8E9E50':'#98BE66','#667430':'#678C37','#5F6B2C':'#5E8636','#707C3E':'#729A48','#4A5522':'#476A27'}
for old,new in ALIAS.items():
  for m in (SP,SU): m[old]=m[new]
  W[old]=W[new]
for old,new in GREENS.items(): W[old]=W[new]
FOREST_SP={'#3F4434':'#2F6A3D','#4A5040':'#3B7B4A','#32362A':'#245A30','#4A5238':'#3A7A44','#575F44':'#4B8B55','#3A412C':'#2C6636','#5F6A5E':'#7FA08A','#566055':'#6F9380','#4A534A':'#5E8070','#6A756A':'#8DAE98','#515B50':'#6C8E78'}
FOREST_SU={'#3F4434':'#2F6A32','#4A5040':'#3C7C3E','#32362A':'#245A28','#4A5238':'#3A7A38','#575F44':'#4B8B48','#3A412C':'#2C662E','#5F6A5E':'#7FA08A','#566055':'#6F9380','#4A534A':'#5E8070','#6A756A':'#8DAE98','#515B50':'#6C8E78'}
FOREST_W={'#3F4434':'#2F5037','#4A5040':'#3A5F46','#32362A':'#27402F','#4A5238':'#34553C','#575F44':'#456A4E','#3A412C':'#2B4733','#5F6A5E':'#7C968B','#566055':'#7C968B','#4A534A':'#6B8579','#6A756A':'#8EA79C','#515B50':'#6B8579'}
EXTRA_SP={'#86A648':'#8DD068','#A8C25A':'#A8DC78','#C0D470':'#BCE890','#6E9040':'#5EA848','#5A7A34':'#4C9440','#6F7A58':'#5A9A4A','#B7B590':'#A8D090','#55654A':'#3F7A3A',
 '#4F6150':'#3E8A4A','#5B6D5C':'#4E9A5A','#425242':'#33783E','#58694F':'#44904A','#647659':'#56A05A','#4A5A42':'#388040','#46584C':'#3A8650','#526458':'#4A9660','#3A4A40':'#2E7444',
 '#8A9468':'#7AB870','#97A176':'#8AC882','#7A8458':'#68A860','#929C70':'#82C078','#9FA97E':'#92D08A','#828C60':'#70B068','#7F8C66':'#7ABC74','#8C9974':'#8CCC84','#6E7B56':'#68A460','#5D8236':'#5E9A48','#78984A':'#86C45A','#2F3D2A':'#2F6A3D','#3A4A34':'#3B7B4A','#222E1E':'#245A30','#5F8A3A':'#5E9A48','#8FAE52':'#9AD06A','#A0BE62':'#B2DC80','#3C5A2C':'#3E7A36','#324C26':'#33682E','#44702E':'#5E9A48','#5E6A5A':'#7FA08A','#6A766A':'#8DAE98','#505A4E':'#6C8E78'}
EXTRA_SU=dict(EXTRA_SP); EXTRA_SU.update({'#86A648':'#78C058','#A8C25A':'#90D068','#C0D470':'#A8E080','#6E9040':'#4E9A3E','#5A7A34':'#3E8434','#6F7A58':'#4E8E44','#B7B590':'#98C880','#55654A':'#366E32',
 '#4F6150':'#348040','#5B6D5C':'#449050','#425242':'#2A6C34','#58694F':'#3A8A40','#647659':'#4C9A50','#4A5A42':'#307A38','#46584C':'#34804A','#526458':'#449058','#3A4A40':'#286E3C',
 '#8A9468':'#74B068','#97A176':'#84C078','#7A8458':'#62A058','#929C70':'#7CB870','#9FA97E':'#8CC882','#828C60':'#6AA860','#7F8C66':'#74B46C','#8C9974':'#84C47C','#6E7B56':'#629C58','#5D8236':'#4A8238','#78984A':'#6DB047','#2F3D2A':'#2F6A32','#3A4A34':'#3C7C3E','#222E1E':'#245A28','#5F8A3A':'#4A8238','#8FAE52':'#80C05A','#A0BE62':'#90CC6A','#3C5A2C':'#336A30','#324C26':'#2A5A28'}); EXTRA_SU['#44702E']='#4A8238'
EXTRA_W={'#86A648':'#E6ECF1','#A8C25A':'#F4F7FA','#C0D470':'#FAFCFD','#6E9040':'#DCE5EE','#5A7A34':'#D0DAE4',
 '#6F7A58':'#8FA0AE','#B7B590':'#EEF3F7','#55654A':'#6F8294','#9A7A4A':'#EEF3F7','#A88858':'#FFFFFF','#7E6238':'#DCE5EE',
 '#4F6150':'#34553C','#5B6D5C':'#456A4E','#425242':'#2B4733','#58694F':'#3A5A41','#647659':'#4B7053','#4A5A42':'#304D37','#46584C':'#34523E','#526458':'#436450','#3A4A40':'#2A4432',
 '#8A9468':'#8EA79C','#97A176':'#9DB4AA','#7A8458':'#7B948A','#929C70':'#98B0A5','#9FA97E':'#A8BDB3','#828C60':'#80998E','#7F8C66':'#88A194','#8C9974':'#96AEA2','#6E7B56':'#718A7F',
 '#3E7A5A':'#F4F7FA','#4F8E6C':'#FFFFFF','#2F6048':'#DCE5EE','#2F6A50':'#E9EFF5','#3F7E62':'#FFFFFF','#245440':'#C7D3DE','#1F4A38':'#C9D4DE','#2C5C48':'#DCE5EE','#143A2C':'#AEBBC8','#5D8236':'#E6ECF1','#78984A':'#F1F5F8','#7F90A3':'#D2DBE5','#8D9CAD':'#C9D5E1','#B8BCC0':'#F4F7FA','#9A9EA2':'#CDD6DF','#CDD0D3':'#FFFFFF','#8A8E92':'#F4F7FA','#9EA2A6':'#FFFFFF','#6E7276':'#CDD6DF','#5F8A3A':'#E6ECF1','#8FAE52':'#F4F7FA','#A0BE62':'#F4F7FA','#3C5A2C':'#DCE5EE','#324C26':'#D5DEE7','#E6EAED':'#F4F7FA','#85503C':'#EEF3F7','#5C3528':'#C9D4DE','#4A5560':'#C9D4DE','#5E6A76':'#EEF3F7','#38424C':'#AEBBC8','#6A5A50':'#FFFFFF','#2E2420':'#C9D4DE','#8A4E3A':'#EEF3F7','#8E9196':'#DCE4EC','#74777C':'#B7C4D0','#6F7378':'#F4F7FA','#80858A':'#FFFFFF','#5A5E62':'#CDD6DF','#77797B':'#F4F7FA','#C9CCCF':'#F4F7FA','#BDB9A8':'#DDE3E8','#A3B2C2':'#DCE4EC','#8E9EB0':'#C9D5E1','#44702E':'#E6ECF1','#A8AAA6':'#C9D4DE','#8A8C8E':'#DCE4EC','#C8CACC':'#F4F7FA','#6A6E72':'#F4F7FA','#7C8084':'#FFFFFF','#52565A':'#CDD6DF','#D0D2D4':'#F4F7FA','#5E5048':'#F4F7FA','#4A3E38':'#CDD6DF','#A09A94':'#B7B1AB','#A3B2C2':'#DCE4EC','#8E9EB0':'#C9D5E1','#7E8EA3':'#D2DBE5','#93A2B4':'#E3EAF1','#8C9BB0':'#DCE4EC','#6F7F8F':'#C3CFDB','#3C3D40':'#C3CDD8','#B9BCB0':'#D5DCE2','#3A3E40':'#F4F7FA','#4E4A48':'#F4F7FA','#625E5C':'#FFFFFF','#2F3530':'#2F3530','#8A5A48':'#EEF3F7','#5E6A5A':'#7C968B','#6A766A':'#8EA79C','#505A4E':'#6B8579','#B3C2CE':'#E3EAF0','#9AAEC0':'#D5DEE8','#8D9FB2':'#C9D5E1','#C9C5B6':'#DDE3E8','#A8A79C':'#C9D4DE',
 '#D9DEE1':'#F4F7FA','#5A4A40':'#F4F7FA','#6E5C50':'#FFFFFF','#E0A82A':'#FFFFFF','#EEC060':'#FFFFFF','#C48A1E':'#DCE5EE','#3E4A4A':'#F4F7FA','#4E5C5C':'#FFFFFF'}
SP.update({'#2A3A24':'#2F6A3D','#34462C':'#3B7B4A','#1E2A1A':'#245A30'})
SU.update({'#2A3A24':'#2F6A32','#34462C':'#3C7C3E','#1E2A1A':'#245A28'})
SP.update(EXTRA_SP); SU.update(EXTRA_SU); W.update(EXTRA_W)
SP.update(FOREST_SP); SU.update(FOREST_SU); W.update(FOREST_W)
W.update({'#3E7A5A':'#3D7049','#4F8E6C':'#4A8556','#2F6048':'#2F5E3C','#2F6A50':'#2F5E3C','#3F7E62':'#3D7049','#245440':'#244A2F','#1F4A38':'#244A2F','#2C5C48':'#2F5E3C','#143A2C':'#1B3824'})
SNOW_FIX={'#3E6B4E':'#C7D3DE','#4F7F5E':'#E9EFF5','#6A9877':'#FFFFFF','#2C5039':'#AEBBC8'}
for k in list(W):
  if W[k] in SNOW_FIX: W[k]=SNOW_FIX[W[k]]
SP.update({'#52602A':'#5E9A48','#6E8A34':'#86C45A','#8AA83E':'#9AD06A','#8EA3B2':'#9FB8CC'})
SU.update({'#52602A':'#4A8238','#6E8A34':'#6DB047','#8AA83E':'#80C05A','#8EA3B2':'#9FB8CC'})
W.update({'#52602A':'#E6ECF1','#6E8A34':'#EEF3F7','#8AA83E':'#F4F7FA','#8EA3B2':'#C9D5E1','#1E2226':'#C3CDD8','#7A7868':'#B7C4D0','#6F6A58':'#B7C4D0',
 '#6B879C':'#F4F7FA','#8FA3B2':'#DCE5EE','#56707F':'#C9D4DE','#3A291E':'#F4F7FA','#4A382A':'#FFFFFF','#2A1D15':'#CDD6DF','#976354':'#EEF3F7'})

import ast
_t=open('tower.py').read()
_i=_t.index('SP = {'); _j=_t.index('\n}\n',_i)
PAL=ast.literal_eval(_t[_i+5:_j+2])
def cap(h): return h[:-1]+'0123456789ABCDEF'[(int(h[-1],16)+1)%16]
FAM={'orange':'o','amber':'o','sunor':'o','canopy_o':'o','orange2':'o','rco':'o','sun':'g','gold':'g','gold2':'g','sunyel':'g','canopy_g':'g','yel':'g','lime':'g','red':'r','rust':'r','rust2':'r','green':'g'}
FAM_ROWS={'rco':'orr'}
TAB={
 'W':{c:[('#FFFFFF','#FFFFFF','#B8C6D4'),('#B8C6D4','#E2EAF1','#9AAABB'),('#9AAABB','#C4D1DE','#7F90A2')] for c in 'ogr'},
 'SU':{'o':[('#4A8840','#5E9A48','#2F6B3A'),('#2F6B3A','#3F7D42','#265C32'),('#265C32','#2F6B3A','#1C4A28')],
       'g':[('#50903C','#5E9A48','#37702F'),('#37702F','#468238','#2C6026'),('#2C6026','#37702F','#224E1E')],
       'r':[('#428A4E','#5A9A56','#2A6440'),('#2A6440','#38754A','#215536'),('#215536','#2A6440','#18442C')]},
 'SP':{'o':[('#F8C6DA','#FCE0EB','#EBA6C3'),('#EBA6C3','#F8C4DA','#DB86AA'),('#DB86AA','#E69DB5','#B9667F')],
       'g':[('#5E9A3E','#70AC4E','#4C8834'),('#4C8834','#5E9A3E','#3A7028'),('#3A7028','#4C8834','#2C5A1E')],
       'r':[('#FFFDF8','#FFFFFB','#F1E9DA'),('#F1E9DA','#FFFBF4','#DED3BF'),('#DED3BF','#E6DCC8','#B8AB92')]}}
MAPS={'W':W,'SU':SU,'SP':SP}
CAPW=('#FFFFFF','#FFFFFF','#DCE5EE')
for sp,rows in PAL.items():
  if sp in ('teal',) or sp.startswith('hz_'): continue
  for k,row in enumerate(rows):
    fam=FAM_ROWS.get(sp,FAM[sp]*3)[k] if sp in FAM_ROWS else FAM[sp]
    for j,h in enumerate(row):
      for nm,m in MAPS.items():
        tab=TAB['W'][fam] if nm=='W' else TAB[nm][fam]
        m[h]=tab[k][j]
      if k==0:
        for nm,m in MAPS.items():
          m[cap(h)]=CAPW[j] if nm=='W' else m[h]
HZ={'hz_o':{'SP':[('#E8BCD0','#F0CCDC','#D8A4BC'),('#D8A4BC','#E4B4CC','#C890AC'),('#C890AC','#D49CB8','#B87C9C')],'SU':[('#86B572','#94C282','#76A562'),('#76A562','#84B170','#6A9858'),('#6A9858','#76A562','#5E8C4E')]},
 'hz_g':{'SP':[('#8CBF6E','#9ACB7C','#78AC5C'),('#78AC5C','#86B868','#6A9E50'),('#6A9E50','#76AA5C','#5E9048')],'SU':[('#7CB060','#8ABE6E','#6C9E52'),('#6C9E52','#78AA5C','#5E9048'),('#5E9048','#6C9E52','#528240')]},
 'hz_r':{'SP':[('#D8A0B8','#E4B4C8','#C48CA6'),('#C48CA6','#D09CB4','#B07C98'),('#B07C98','#BC88A4','#9C6C88')],'SU':[('#6FA076','#7EAF84','#608F66'),('#608F66','#6E9C74','#547F5A'),('#547F5A','#608F66','#486F4E')]}}
HZW=[('#DCE5EE','#F2F6FA','#B8C6D4'),('#B8C6D4','#D0DAE4','#9AAABB'),('#9AAABB','#B0BECC','#8696A8')]
for sp,tabs in HZ.items():
  if sp not in PAL: continue
  for k,row in enumerate(PAL[sp]):
    for j,h in enumerate(row):
      SP[h]=tabs['SP'][k][j]; SU[h]=tabs['SU'][k][j]; W[h]=HZW[k][j]
      if k==0: SP[cap(h)]=SP[h]; SU[cap(h)]=SU[h]; W[cap(h)]=('#F2F6FA','#FFFFFF','#DCE5EE')[j]
TEALW={'#3E6446':'#3D7049','#4C7656':'#4A8556','#2C4A34':'#2F5E3C','#34563D':'#2F5E3C','#26402D':'#244A2F','#1E3425':'#1B3824'}
W.update(TEALW)
W['#5A3A30']='#6A5A52'; W['#B2A99A']='#8A9AAA'
SU.update({'#86A648':'#9CC45A','#A8C25A':'#AED468','#C0D470':'#BEE078','#6E9040':'#98C058','#5A7A34':'#7EAA48'})
HGS={'SP':{'#4E8F4A':'#62A852','#5E9F58':'#74B864','#3F7A3C':'#4E9040','#3C7A3E':'#559A4A','#4A8A4C':'#66AA5A','#2F6632':'#448440',
  '#E0862E':'#F2B0CC','#EE9F52':'#F8C6DA','#C06A1E':'#E096B6','#EBB43A':'#C8E08A','#F4CB62':'#D8EC9E','#C99722':'#A8C86C','#CF5A2C':'#F6EEE0','#E07A50':'#FFFBF2','#AC4420':'#E0D4C0','#5C9A4C':'#6AB05A'},
 'SU':{'#4E8F4A':'#3E8A3E','#5E9F58':'#4E9A4A','#3F7A3C':'#2F7632','#3C7A3E':'#368036','#4A8A4C':'#459044','#2F6632':'#2A6C2E',
  '#E0862E':'#6AA040','#EE9F52':'#7AB050','#C06A1E':'#5A9036','#EBB43A':'#8AB84A','#F4CB62':'#9AC85C','#C99722':'#7AA83C','#CF5A2C':'#4E8E4A','#E07A50':'#5E9E58','#AC4420':'#3E7A3C','#5C9A4C':'#4E9044'},
 'W':{'#4E8F4A':'#34553C','#5E9F58':'#3A5F46','#3F7A3C':'#27402F','#3C7A3E':'#2B4733','#4A8A4C':'#34553C','#2F6632':'#223B2A',
  '#E0862E':'#7F94A6','#EE9F52':'#93A6B6','#C06A1E':'#6C8092','#EBB43A':'#8A9EB0','#F4CB62':'#9CAEBE','#C99722':'#74899B','#CF5A2C':'#7389A0','#E07A50':'#8499AD','#AC4420':'#657B90','#5C9A4C':'#8FA0AE'}}
SP.update(HGS['SP']); SU.update(HGS['SU']); W.update(HGS['W'])
SP.update({'#8FB8E2':'#86C0F0','#DDE8EE':'#E4F0F8'})
for h in ('#4C7A3C','#78B552','#A9CF8E','#EDE3C6','#E9DFC4'): SP.pop(h,None); SU.pop(h,None)  # H5 lawn greens in every green season
SU.update({'#8FB8E2':'#6AA6EA','#DDE8EE':'#E6F0F8'})
for h in ('#4C7A3C','#78B552','#A9CF8E','#EDE3C6','#E9DFC4','#5C9A4C'): W.pop(h,None)
random.seed(5)
snow=''.join(f'<circle cx="{random.randint(0,1144)}" cy="{random.randint(0,520)}" r="{random.choice([1.5,2,2.5,3])}" fill="#FFFFFF" opacity="{random.choice([0.6,0.8,1])}"/>' for _ in range(140))
caps='<path d="M918 214 C926 198 940 192 955 192 C970 192 984 198 992 214 C975 206 935 206 918 214 Z" fill="#FFFFFF"/><path d="M934 146 C940 133 970 133 976 146 C966 141 944 141 934 146 Z" fill="#FFFFFF"/><rect x="884" y="341" width="148" height="4" rx="2" fill="#FFFFFF"/><rect x="888" y="305" width="140" height="4" fill="#FFFFFF"/><polygon points="882,456 1034,456 1038,462 878,462" fill="#FFFFFF"/>'
def season(s,name):
  if name=='fall': return s
  if name=='spring': return hexmap(s,SP)
  if name=='summer': return hexmap(s,SU)
  if name=='winter':
    s=strmap(s,W); s=hexmap(s,W); return s.replace('</svg>',caps+snow+'</svg>')
NLAWN={'#4C7A3C':'#34483C','#78B552':'#3E5A47','#86A648':'#34483C','#A8C25A':'#3B5243','#C0D470':'#445B4B','#6E9040':'#2F4337','#5A7A34':'#283A2E'}
TOWER={'#F4F2EB':'#DCE1EA','#FFFFFC':'#F2F4F8','#D3CFC2':'#9AA3B8','#C9C4B7':'#8A93A8','#CFCBBE':'#9AA3B8','#E6E2D7':'#8A93A8',
 '#9C4A36':'#6A3326','#B05A44':'#7A3D2E','#7E3828':'#4F241A','#2B2F35':'#2B2F35','#FFD98A':'#FFD98A','#FFC86B':'#FFC86B','#3E2A21':'#3E2A21','#E6EAEC':'#DCE1EA','#F4F7F8':'#F2F4F8','#B8C0C5':'#9AA3B8','#B4BCC1':'#8A93A8','#C4CBD0':'#A5AEC2','#98A1A7':'#7A839A','#ECEBE6':'#DCE1EA','#D4D2CC':'#9AA3B8','#F4EFE4':'#F2F4F8','#3A2E2A':'#3A2E2A','#5A4A44':'#5A4A44','#4A4240':'#4A4240','#373131':'#373131','#D8D8D8':'#D8D8D8','#55524C':'#55524C','#2F2D2C':'#2F2D2C','#4A4740':'#4A4740','#5E5B52':'#5E5B52','#38362F':'#38362F','#C9CCD0':'#C9CCD0','#DCE0E5':'#C9CEDA','#C9CDD3':'#A5AEC2','#E6E4DE':'#C9CEDA','#2F3530':'#1E2028','#4A5058':'#FFD98A','#C4C9CF':'#9AA3B8','#EDEBE6':'#DCE1EA','#6B5547':'#6B5547','#3A2C24':'#3A2C24','#241A15':'#241A15','#8A6450':'#8A6450','#7C5848':'#4A4258','#B0654A':'#8A6460','#E8E2D7':'#4A4258','#D8D0C5':'#4A4258'}
LIT={'#D9CFB4':'#FFD98A','#2F3A30':'#FFD98A','#EDE6D6':'#FFD98A','#F3E9D6':'#FFD98A','#2F4A3A':'#FFD98A','#6A7480':'#FFD98A','#2B2F36':'#FFC86B','#2B2F34':'#FFD98A','#3A2820':'#FFD98A'}
CLOUD={}  # no clouds in the art; old cloud hexes now collide with winter snow tones
def night(raw,name):
  s=raw.replace('stop-color="#8FB8E2"','stop-color="#0E1A33"').replace('stop-color="#DDE8EE"','stop-color="#1E2C4E"').replace('stop-color="#F3E9D6"','stop-color="#33395E"')
  s=s.replace('stop-color="#FFD98A" stop-opacity="0.45"','stop-color="#FFD98A" stop-opacity="0"')
  s=re.sub(r'<g id="clouds">.*?</g>','',s,flags=re.S)
  s=re.sub(r'<g id="lean">.*?</g>','',s,flags=re.S)
  s=hexmap(s,LIT)
  s=season(s,name)
  s=s.replace('stop-color="#FFFFFF" stop-opacity="0.35"','stop-color="#FFFFFF" stop-opacity="0"')
  f=0.42 if name=='winter' else 0.34
  tw=dict(TOWER)
  if name in ('spring','summer'):
    mm=SP if name=='spring' else SU
    for h,v in NLAWN.items(): tw[mm.get(h,h).upper()]=v
  elif name=='fall': tw.update(NLAWN)
  def dk(h):
    u=h.upper()
    if u in tw: return tw[u]
    if u in CLOUD: return CLOUD[u]
    if u in ('#0E1A33','#1E2C4E','#33395E'): return u
    r,g,b=(int(u[i:i+2],16) for i in (1,3,5))
    if name=='winter' and (r+g+b)/3>165:
      return '#%02X%02X%02X'%(int(r*0.6+24),int(g*0.62+30),int(b*0.66+46))
    return '#%02X%02X%02X'%(min(255,int(r*f+7)),min(255,int(g*f+13)),min(255,int(b*(f+0.06)+26)))
  s=re.sub(r'#[0-9A-Fa-f]{6}', lambda x: dk(x.group(0)), s)
  random.seed(9)
  pts=[(random.randint(0,1144),random.randint(0,190)) for _ in range(170)]
  pts=[p for p in pts if not (p[0]<640 and p[1]<190)][:100]
  stars=''.join(f'<circle cx="{x}" cy="{y}" r="{random.choice([0.8,1.2,1.6])}" fill="#FFFFFF" opacity="{random.choice([0.5,0.7,0.9])}"/>' for (x,y) in pts)
  moon='<circle cx="720" cy="70" r="22" fill="#F4EBD0"/><circle cx="732" cy="62" r="20" fill="#0E1A33"/>'
  glow='<defs><radialGradient id="tg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFE3A3" stop-opacity="0.35"/><stop offset="1" stop-color="#FFE3A3" stop-opacity="0"/></radialGradient></defs><ellipse cx="955" cy="230" rx="190" ry="240" fill="url(#tg)"/>'
  return s.replace('fill="url(#sky)"/>','fill="url(#sky)"/>'+stars+moon+glow,1)
day=open('base-day.svg').read(); nt=open('base-night.svg').read()
for n in ('fall','winter','spring','summer'):
  open(f'p-{n}-day.svg','w').write(season(day,n))
  open(f'p-{n}-night.svg','w').write(night(nt,n))
print('ok')
