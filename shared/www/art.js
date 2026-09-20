(function (root) {
  'use strict';
  const colors = { salmon: '#ed8559', eel: '#956034', roe: '#de743e', green: '#263b29', baked: '#dfab65', tempura: '#d6aa61' };
  function roll(x, y, kind, angle = 0, scale = 1) {
    const color = colors[kind] || colors.salmon;
    const outer = kind === 'green' ? '#293c2b' : color;
    const stripes = kind === 'salmon' ? '<path d="M-27,-13Q-12,-6 -6,8M-14,-18Q0,-7 5,10M1,-18Q14,-7 18,6" stroke="#ffcb9a" stroke-width="3.5" fill="none" opacity=".8"/>' : '';
    const sesame = ['eel','roe','tempura','baked'].includes(kind) ? '<g fill="#f8db9e"><ellipse cx="-21" cy="-6" rx="1.3" ry="3" transform="rotate(-25 -21 -6)"/><ellipse cx="-11" cy="-11" rx="1.3" ry="3"/><ellipse cx="14" cy="-8" rx="1.3" ry="3" transform="rotate(35 14 -8)"/><ellipse cx="20" cy="2" rx="1.3" ry="3"/><ellipse cx="0" cy="-15" rx="1.3" ry="3"/></g>' : '';
    return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"><ellipse cy="20" rx="34" ry="18" fill="#122014" opacity=".16"/><path d="M-32,-3L-31,18C-26,38 28,38 32,17L32,-3Z" fill="${outer}"/><path d="M-31,2L-30,18C-22,30 23,30 31,16L31,2Z" fill="#fff8df" opacity="${kind === 'green' ? '.06' : '.85'}"/><ellipse rx="33" ry="23" fill="${outer}"/><ellipse rx="27" ry="18.5" fill="#fff9e5"/><g stroke="#d8d7bd" stroke-width="1.1" opacity=".7"><path d="M-21,-6l4,1m-6,7l4,-1m6,-13l1,3m22,-1l-2,2m7,6l3,1m-26,9l4,1m14,-1l4,-2m-9,-23l1,3"/></g><ellipse rx="17" ry="12.5" fill="#294430"/><ellipse cx="-3" cy="-1" rx="11" ry="9" fill="#f4eed6"/><path d="M-1,-10C14,-11 20,3 9,9L0,4Z" fill="${kind === 'green' ? '#a1b75b' : '#ed9166'}"/><path d="M-14,1L-7,2 -4,10 -12,9Z" fill="#80a452"/>${stripes}${sesame}</g>`;
  }
  function art(kind, hero = false) {
    let inside = '';
    if (kind === 'drink' || kind === 'berry') {
      const color = kind === 'berry' ? '#a94b61' : '#e9b445';
      inside = `<ellipse cx="157" cy="205" rx="60" ry="14" fill="#34462e" opacity=".12"/><path d="M115,63h78l-8,136q-30,18 -61,0Z" fill="#dce6d5"/><path d="M120,83h68l-7,110q-26,13 -52,0Z" fill="${color}"/><ellipse cx="154" cy="83" rx="34" ry="9" fill="${kind === 'berry' ? '#c47488' : '#f5ce66'}"/><path d="M157,142l23,-106h18" stroke="#fffbed" stroke-width="7" fill="none"/><g fill="#fffcea" opacity=".5"><rect x="129" y="91" width="18" height="21" rx="4" transform="rotate(-16 129 91)"/><rect x="158" y="119" width="18" height="21" rx="4" transform="rotate(18 158 119)"/></g><circle cx="119" cy="81" r="23" fill="#729255"/><circle cx="119" cy="81" r="18" fill="#d4d98c"/><path d="M119,64v33M102,81h34M107,70l24,23M108,94l23,-24" stroke="#f4edb2" stroke-width="2"/>`;
    } else if (kind === 'nigiri') {
      inside = '<ellipse cx="150" cy="189" rx="107" ry="29" fill="#283f2d" opacity=".13"/><ellipse cx="149" cy="152" rx="109" ry="49" fill="#f8f4df"/><path d="M48,141Q88,100 215,113Q264,128 236,159Q186,180 54,159Z" fill="#ee9066"/><path d="M73,124l36,36M108,115l43,50M151,114l41,46M193,118l30,34" stroke="#ffd4a9" stroke-width="8" fill="none"/>';
    } else if (kind === 'sauce' || kind === 'ginger') {
      inside = `<ellipse cx="150" cy="187" rx="89" ry="27" fill="#243c2a" opacity=".12"/><path d="M62,119Q70,198 149,198Q228,196 238,119Z" fill="#dadbca"/><ellipse cx="150" cy="119" rx="89" ry="42" fill="#fffced"/><ellipse cx="150" cy="119" rx="73" ry="30" fill="${kind === 'sauce' ? '#503427' : '#f1baae'}"/>${kind === 'ginger' ? '<path d="M95,120q0,-35 34,-13q26,-34 33,5q35,-18 35,11q-22,34 -50,12q-31,29 -52,-15" fill="#f8cdc0"/><path d="M187,140l20,-38 22,43Z" fill="#9da95d"/>' : '<ellipse cx="132" cy="110" rx="36" ry="6" fill="#946944" opacity=".4"/>'}`;
    } else {
      const type = kind === 'set' ? 'salmon' : kind;
      inside = `<ellipse cx="152" cy="152" rx="132" ry="83" fill="${hero ? '#b6bfa6' : '#d7dccb'}" opacity=".4"/><ellipse cx="151" cy="139" rx="129" ry="83" fill="#304336"/><ellipse cx="150" cy="136" rx="119" ry="74" fill="#394d3b"/><path d="M63,173Q124,217 224,167" fill="none" stroke="#5d6c51" opacity=".4" stroke-width="2"/>`;
      if (kind === 'set') {
        inside += roll(107,88,'eel',-13,.78) + roll(158,87,'roe',0,.78) + roll(206,101,'baked',15,.78) + roll(79,133,'salmon',-12,.85) + roll(135,132,'salmon',0,.85) + roll(191,146,'green',12,.85) + roll(103,180,'salmon',-10,.85) + roll(163,186,'roe',3,.85);
      } else {
        inside += roll(117,91,type,-12,.86) + roll(178,101,type,7,.86) + roll(89,133,type,-15,.9) + roll(151,142,type,0,.9) + roll(211,146,type,15,.85) + roll(121,185,type,-8,.9);
      }
      inside += '<path d="M219,188q-11,-28 9,-35q22,7 18,29q-12,16 -27,6" fill="#94a365"/><path d="M45,166q-14,-13 0,-18q13,-12 20,2q20,-1 14,15q-22,7 -34,1" fill="#e7b5a0"/>';
    }
    return `<svg class="food-art${hero ? ' hero-art' : ''}" viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Иллюстрация блюда">${inside}</svg>`;
  }
  root.UnagiArt = art;
})(globalThis);
