import random, re
import sys
base=open(sys.argv[1]).read()
def apply(m, extra_after_sky='', extra_end=''):
  s=base
  for k,v in m.items(): s=s.replace(k,v)
  s=s.replace('fill="url(#sky)"/>','fill="url(#sky)"/>'+extra_after_sky,1)
  return s.replace('</svg>',extra_end+'</svg>')
random.seed(5)
W={'#7C838C':'#C3CDD8','#8DB04A':'#EEF3F7','#A9C1D8':'#DCE5EE','#98B3CC':'#C9D5E1','#EDE3C6':'#C3CDD8','#A9CF8E':'#DCE3EA','#F4F8FB':'#E8EEF3','#DCE6EE':'#C9D4DE','#E6E2D8':'#E6E2D8','#78B552':'#EEF3F7','#D9D2BE':'#B7C4D0','#B7C7D8':'#E1E8EF','#C9D6E3':'#F4F7FA','#A5B6C9':'#CBD6E0','#F7A64A':'#FFFFFF','#FBC27E':'#FFFFFF','#E08A2C':'#DCE5EE','#C2611A':'#C9D4DF','#D27A34':'#DCE5EE','#9E4C12':'#AEBBC8','#F9CF5E':'#FFFFFF','#FCE08F':'#FFFFFF','#E5B73E':'#DCE5EE','#CF9324':'#C9D4DF','#DDAA45':'#DCE5EE','#A9741A':'#AEBBC8','#E8714A':'#FFFFFF','#F29171':'#FFFFFF','#CB5530':'#DCE5EE','#A9401E':'#3E6B4E','#BC5634':'#4F7F5E','#852F14':'#2C5039','#9CC25A':'#F4F7FA','#B5D47E':'#FFFFFF','#82A843':'#DCE5EE','#7FA84A':'#E9EFF5','#98BE66':'#FFFFFF','#678C37':'#C7D3DE','#5E8636':'#C9D4DF','#729A48':'#DCE5EE','#476A27':'#AEBBC8','rgb(20 40 20 / 28%)':'rgb(90 110 130 / 22%)','#C4D6E4':'#AFC3D6','#E6EBE8':'#E6ECF1','#F3E9D6':'#F2F4F6','stop-color="#FFD98A" stop-opacity="0.45"':'stop-color="#FFFFFF" stop-opacity="0.35"',
 '#A7B9CC':'#DCE5EE','#BCCBDA':'#F2F6FA','#93A6BA':'#C3CFDB',
 '#E8862A':'#E9EFF5','#F2A55A':'#FFFFFF','#C66B18':'#C7D3DE','#F2B53B':'#DDE6EE','#F7CD6E':'#F7FAFC','#D4972A':'#BCC9D5',
 '#D8572A':'#4F7F5E','#E9774F':'#6A9877','#B4431D':'#3E6B4E','#8DB04A':'#E4EBF1','#A6C468':'#FFFFFF','#6F9136':'#C3CFDB',
 '#4C7A3C':'#E6ECF1','#7DBA57':'#F1F5F8','#6EAA4B':'#E3EAF0','#E9DFC4':'#C9D4DE',
 '#4A4F57':'#F4F7FA','#5E646D':'#FFFFFF','#363A40':'#CDD6DF','#5A3A30':'#F4F7FA'}
snow=''.join(f'<circle cx="{random.randint(0,1144)}" cy="{random.randint(0,520)}" r="{random.choice([1.5,2,2.5,3])}" fill="#FFFFFF" opacity="{random.choice([0.6,0.8,1])}"/>' for _ in range(140))
caps='<path d="M874 160 C890 138 970 138 986 160 C960 152 900 152 874 160 Z" fill="#FFFFFF"/><path d="M904 104 C914 94 946 94 956 104 C940 100 920 100 904 104 Z" fill="#FFFFFF"/><rect x="834" y="392" width="192" height="5" rx="2" fill="#FFFFFF"/><rect x="852" y="252" width="150" height="4" fill="#FFFFFF"/>'
open('tower-winter.svg','w').write(apply(W,'',caps+snow))
N={'#FFFFFD':'#1C2848','#F4F8FB':'#18233F','#DCE6EE':'#141D36','#A9C1D8':'#26314F','#98B3CC':'#1E2843','#FFFFFD':'#1C2848','#EDE3C6':'#6B7A8C','#A9CF8E':'#2F4F3B','#F4F8FB':'#18233F','#DCE6EE':'#141D36','#E6E2D8':'#8A93A8','#78B552':'#22402E','#D9D2BE':'#4E5A68','#F4F2ED':'#4E5770','#FFFFFE':'#5C6680','#D3CFC4':'#3C4459','#B7C7D8':'#2A3654','#C9D6E3':'#34426A','#A5B6C9':'#222C45','#C4D6E4':'#0E1A33','#E6EBE8':'#1E2C4E','#F3E9D6':'#33395E','stop-color="#FFD98A" stop-opacity="0.45"':'stop-color="#FFD98A" stop-opacity="0"',
 '#A7B9CC':'#2A3654','#BCCBDA':'#34426A','#93A6BA':'#222C45',
 '#3F7A4E':'#1F3A33','#4F8E5E':'#28483F','#30613D':'#172C27','#2F5E3C':'#16302A','#3D7049':'#1E3B33','#244A2F':'#10231E',
 '#E8862A':'#7A4A2A','#F2A55A':'#8E5A36','#C66B18':'#5E3820','#F2B53B':'#7E6430','#F7CD6E':'#94763E','#D4972A':'#5F4A22',
 '#D8572A':'#6E3326','#E9774F':'#82402F','#B4431D':'#55271C','#8DB04A':'#3F5530','#A6C468':'#4D663A','#6F9136':'#304225',
 '#4C7A3C':'#1C3029','#7DBA57':'#24402F','#6EAA4B':'#20392A','#E9DFC4':'#5C6A7A',
 '#E9E6DF':'#4A5268','#F4F2EC':'#DCE1EA','#D3CFC3':'#9AA3B8','#C9C4B8':'#8A93A8','#CFCBBF':'#9AA3B8',
 '#6B3A2E':'#3B2421','#83493A':'#4A2E29','#52291F':'#2A1816','#8C4A38':'#45291F','#A05A46':'#563428','#6E382A':'#311C16',
 '#7A3E2E':'#3E241E','#8F4E3C':'#4D2E26','#5E2E22':'#2C1814','#9C4A36':'#6A3326','#B05A44':'#7A3D2E','#7E3828':'#4F241A',
 '#F3E9D6':'#FFD98A','#2F4A3A':'#FFD98A','#6A7480':'#FFD98A','#4A4F57':'#1E222B','#5E646D':'#2A2F3A','#363A40':'#151820',
 '#B9BEC4':'#4A5268','#D2D6DA':'#5A637A','#9AA0A7':'#3A4155','#2B2F36':'#FFC86B','#2B2F34':'#FFD98A','#5A3A30':'#1E222B'}
pts=[(random.randint(0,1144),random.randint(0,190)) for _ in range(160)]
pts=[p for p in pts if not (p[0]<520 and p[1]<180)][:110]
stars=''.join(f'<circle cx="{x}" cy="{y}" r="{random.choice([0.8,1.2,1.6])}" fill="#FFFFFF" opacity="{random.choice([0.5,0.7,0.9])}"/>' for (x,y) in pts)
moon='<circle cx="700" cy="70" r="22" fill="#F4EBD0"/><circle cx="712" cy="62" r="20" fill="#0E1A33"/>'
glow='<defs><radialGradient id="tg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFE3A3" stop-opacity="0.35"/><stop offset="1" stop-color="#FFE3A3" stop-opacity="0"/></radialGradient></defs><ellipse cx="930" cy="230" rx="190" ry="240" fill="url(#tg)"/>'
nb=base
# night: sky stop #F3E9D6 conflicts with window color; handle sky first
s=base.replace('stop-color="#F3E9D6"','stop-color="#33395E"')
def dk(h,f=0.45):
  h=h.lstrip('#'); r,g,b=(int(h[i:i+2],16) for i in (0,2,4)); m=(r+g+b)/3
  r,g,b=(int((c*0.7+m*0.3)*f) for c in (r,g,b)); return '#%02X%02X%02X'%(r,g,b)
for c in ['#F7A64A','#FBC27E','#E08A2C','#C2611A','#D27A34','#9E4C12','#F9CF5E','#FCE08F','#E5B73E','#CF9324','#DDAA45','#A9741A','#E8714A','#F29171','#CB5530','#A9401E','#BC5634','#852F14','#9CC25A','#B5D47E','#82A843','#7FA84A','#98BE66','#678C37','#5E8636','#729A48','#476A27']:
  N.setdefault(c,dk(c))
for k,v in N.items(): s=s.replace(k,v)
s=s.replace('fill="url(#sky)"/>','fill="url(#sky)"/>'+stars+moon+glow,1)
open('tower-night.svg','w').write(s)
print('ok')
