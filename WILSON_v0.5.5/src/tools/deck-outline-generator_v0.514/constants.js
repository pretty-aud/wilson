// 4 preset themes (used when AI generation is disabled)
export const PRESET_THEMES = [
  { name: 'Black & Orange', colors: ['#0a0a0a', '#f97316', '#b45309', '#f97316'] },
  { name: 'Orange & Black', colors: ['#f97316', '#0a0a0a', '#7c2d12', '#0a0a0a'] },
  { name: 'Black & White', colors: ['#0a0a0a', '#ffffff', '#a3a3a3', '#e5e5e5'] },
  { name: 'White & Black', colors: ['#f5f5f5', '#171717', '#525252', '#262626'] },
];

export const SLIDE_LAYOUTS = [
  { id: 'title_slide', name: 'Title slide', description: 'Main title with subtitle, centered' },
  { id: 'section_header', name: 'Section header', description: 'Large section divider text' },
  { id: 'title_body', name: 'Title and body', description: 'Title with body text below' },
  { id: 'title_two_columns', name: 'Title and two columns', description: 'Title with two column layout' },
  { id: 'title_three_columns', name: 'Title and three columns', description: 'Title with three column layout' },
  { id: 'title_four_columns', name: 'Title and four columns', description: 'Title with four column layout' },
  { id: 'title_only', name: 'Title only', description: 'Large title, minimal content' },
  { id: 'one_column', name: 'One column text', description: 'Single column text layout' },
  { id: 'main_point', name: 'Main point', description: 'Emphasized key message' },
  { id: 'section_title_desc', name: 'Section title and description', description: 'Section title with description text' },
  { id: 'caption', name: 'Caption', description: 'Image-focused with caption text' },
  { id: 'big_number', name: 'Big number', description: 'Large statistic or figure' },
  { id: 'blank', name: 'Blank', description: 'Empty slide for custom layout' },
  { id: 'section_header_gradient', name: 'Section Header w/Gradient', description: 'Section header with gradient background' },
  { id: 'title_page_gradient', name: 'Title Page w/Gradient', description: 'Title slide with gradient background' },
];
