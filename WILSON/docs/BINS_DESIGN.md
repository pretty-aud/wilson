# The bin system — design note

Written 2026-09-10 for `docs/sessions/DEMO_BINS_BRIEF.md` §3, before any code.
Sections 1–3 are what Avid Media Composer and Adobe Premiere Pro do and what
editors do with them, each claim with its source. Section 4 maps that onto
R.A.B.B.I.T. as it exists on `feat/demo-2026-09-11` and proposes the data
model; every field there points back at a line in 1–3. Section 5 lists the
questions the research left for Audrey; §6 records her answers once given.

**The argument in one paragraph.** Both editors treat a bin as a container
*inside the project*, not a folder on disk, ordered by hand and organised per
shoot day, per scene and per media type. A clip's name in the bin is separate
from the file's name on disk, which is never changed. Logging (scene, shot,
take, camera, roll, day, notes, a good / preferred flag) is typed at ingest
because it lives nowhere else; the technical columns (duration, timecode,
frame size, fps, codec) are read from the file. Review is a three-state flag
with a colour label, and "selects" are a saved filter rather than copies. One
shot in the cut is routinely built from several takes. R.A.B.B.I.T. adopts
exactly that, on top of the managed-files plumbing it already has for bytes,
streaming and poster frames.

**Sourcing caveats.** Adobe rewrote its Premiere guide in 2025–26 and dropped
the full column table; Avid's current column reference (Editing Guide ch. 10)
is gated. Where a field name could not be read from a live primary page it is
marked as such rather than asserted. The research was done by three web
agents on 2026-09-10 and condensed here; the URLs are theirs.

---
## 1. How Avid Media Composer organises bins

**A bin is a database of media objects, and a file on disk.** Avid's *Set Bin
Display* dialog enumerates what a bin holds: master clips, subclips,
sequences, source clips, rendered effects, group clips (multicam), effect
templates ([Film Composer guide][a1], [Frame.io effects bins][a19]). A project
has many bins, organised in folders; since Media Composer 2019 the Project
window is the *Bin Container* whose sidebar "displays the contents of your
project including scripts, bins, volumes, and folders" ([What's New
2019.6][a4]). Every bin is its own `.avb` file beside the `.avp` project
file, which is why the bin is the unit of collaboration: in a shared project
a bin opens in *Write* or *Read-Only* mode, a `.lck` sidecar names the writer,
a green or red padlock shows which you hold, and editors who need a locked
bin open it read-only and copy clips into a bin of their own ([FrameOne][a11],
[Frame.io bin locking][a9], [Elements][a10]).

**Views.** Avid's guides name three display modes, *Text*, *Frame* and
*Script*, switched from the T / F / S buttons (now in the Bin Tools row with a
search field and the bin fast menu) ([Film Composer guide][a1], [What's New
2019.6][a4]). *Text* view "provides the most complete view of clip
information. It uses database columns that you can rearrange and customize"
([Media Composer guide][a2]). *Frame* view shows one poster frame per clip
with its name beneath; the head frame is the default but holding `K` and
pressing `L` or `J` rolls the footage inside the tile and the frame it is
released on is saved with the bin; frames enlarge and reduce in five sizes,
all together ([Film Composer guide][a1]). *Script* view puts the frames in a
column with a text box beside each and the Text-view data above the box
([Film Composer guide][a1]). *Brief* view appears in secondary sources as a
fixed preset of Text view showing start, duration, tracks and offline state
([Avid Xpress Pro Power][a22], [alex4d][a23]). Editors arrange Frame view
semantically, "into rows of setups and columns of takes", or by story beat,
then `Bin → Align to Grid` / `Fill Sorted` (Ctrl+T, "tidy up")
([FSU film handbook][a24], [Frame.io story beats][a17]). Hover-scrub is an
Avid *MediaCentral* feature, not a Media Composer bin feature; the Media
Composer equivalent is the K+L scrub above ([Avid MediaCentral help][a6]).

**Columns.** *Name* is permanent; every other column is opt-in through
*Choose Columns…* ([ProVideo Coalition columns][a12]). The statistical
columns set at capture are *Start*, *End*, *Duration*, *Tracks*, *Resolution*
and *Drive*; *Mark IN* and *Mark OUT* are editable in the bin and altering
one changes the IN–OUT duration ([Film Composer guide][a1], [Media Composer
guide][a2]). The production columns logged by hand or from a log are
*Labroll*, *Camroll*, *Soundroll*, *Scene* and *Take* ("You can continue to
log film data into the Labroll, Camroll, Soundroll, Scene, and Take columns,
or into your own custom columns") ([Film Composer guide][a1]); timecode
columns are *Aux TC1–5*, *Sound TC* and *Film TC*; *Color* is the clip-colour
column ([Film Composer guide][a1], [Frame.io colour coding][a16]). *Audio
SR*, *FPS*, *Format*, *Video*, *Creation Date*, *IN-OUT*, *Shoot Date*,
*Camera*, *Reel #* and *Comments* are real columns confirmed only through
search snippets; the current column reference is Chapter 10 of the Editing
Guide, which is gated ([Elements chapter map][a13]). Custom columns are made
in the *Custom* view by clicking right of the last heading and typing a
name; editors add Rating, Shot Type, Shot Composition (CU, MCU, MS, LS) and
Keywords ([PremiumBeat custom columns][a14]); Alt-right-click in a custom
column offers previously entered values, and multi-selecting clips then
editing one cell fills them all; *Bulk Edit* and *Find and Replace* exist
since 2020 ([ProVideo Coalition columns][a12], [Frame.io batch rename][a18]).

**Bin views, sorting, sifting, find.** Avid ships *Statistics*, *Film* and
*Custom* bin views and saves user views with the user profile ([Film
Composer guide][a1], [PremiumBeat custom columns][a14]). Sort on a heading
(`Bin → Sort`, or right-click → Sort on Column); multi-column sort uses column
order, so precedence is set by rearranging columns; sorting is a Text-view
operation ([Film Composer guide][a1], [PremiumBeat sorts and sifts][a15]).
*Custom Sift* (`Bin → Custom Sift`) filters with *Contains*, *Begins With*
or *Matches Exactly* on a chosen column, up to six criteria with AND/OR, and
the sifted bin is labelled "partial" or "Sifted" depending on version
([Film Composer guide][a1], [PremiumBeat sorts and sifts][a15]). `Ctrl+F`
opens *Find*, which searches bin metadata, scripts and the timeline
([PremiumBeat find tool][a20]).

**Locators and markers.** A locator "mark[s] a single frame within a clip or
sequence" and carries text; locators can be added during capture and copied
from source clips into sequences ([Media Composer guide][a2]). Renamed
*Markers*, they carry a colour set by the button used and are listed in the
Markers tool; *Spanned Markers* mark a range, which is the logging idiom for
interviews ("put Spanned Markers around all of the good answers")
([ProVideo Coalition markers][a21]). Assistants put a green marker on the
action point of each synced take and label NG takes red ([FSU][a24]).

**Script integration and ScriptSync.** Script integration is core: `File →
New Script` imports a text file into a script bin; takes are organised into
*slates* (a representative frame and clip name), *takes* hang from each slate
as nodes, *indicators* colour "preferred takes, takes used in the current
active sequence, or line changes", and *script marks* link dialogue lines to
the frames that speak them ([Media Composer guide][a2]). Coverage reads as
vertical take lines through the text exactly like a lined script: master
`33/1`, then `33A/1`, `33A/2`, jagged where dialogue is off-screen
([ScriptSync guide][a3]). ScriptSync (phonetic matching by Nexidia) automates
the marks ([ScriptSync guide][a3], [Oliver Peters hidden gems][a25]). The
division of labour is explicit: the continuity person lines the script on
set, the assistant lines it digitally and links clips, the editor cuts from
the script window ([Media Composer guide][a2]).

**Circled takes, good takes, selects.** The circle comes from the script
supervisor and "indicate[s] the take the director liked the most"
([Celtx lining][a26]). It reaches Avid through the ALE (a *Circled Take* /
*Circle* column reported as mapping to a Selected Take field; the exact
header is unverified) ([COPRA mapping][a27]). Inside Media Composer the
durable mechanisms are the script window's preferred-take indicator, the
*Color* column with `Select → Clips with Same Source Color` to gather a
colour, and a custom Rating column ([Media Composer guide][a2],
[Frame.io colour coding][a16], [PremiumBeat custom columns][a14]).
Sequence-level selects are stringouts (a scene's dailies end to end, cut from
rather than from the clips) and selects sequences of the best one or two
takes, kept in stringout and selects bins ([Frame.io stringouts][a28],
[Block Reel][a29], [FSU][a24]).

**ALE and what arrives from set.** An ALE is a tab-delimited text file with
a global header (frame rate, format), a `Columns` line and `Data` rows, one
per clip; documented columns include Name, Tracks, Start, End, Auxiliary
TC1/2, Camroll, Labroll, Scene, Take and ASC CDL values; *Camera* names the
unit, *Soundroll* the recorder's roll, *Aux TC1* the audio timecode for sync
([Pomfort ALE][a30], [ALE column list][a31]). It is imported with `Input →
Import Media… → Options → Shot Log → Merge events with known master clips`,
matching on source file name or tape plus exact Start and End; known fields
fill Avid's columns and unknown ones become custom columns, and *Combine
events based on scene and automatically create subclips* turns Scene / Take
rows into subclips ([Pomfort transfer][a32], [Creative COW][a33]). Without a
log the same fields are typed into the bin ([Film Composer guide][a1]).

**Master clip, subclip, duplicate, clip colour.** A master clip is the
captured item pointing at media; a subclip is "a portion of one master clip"
made from Mark IN / OUT and dragged into a bin; re-digitising a subclip
breaks its link to the master; a *duplicate* is "a separate clip linked to
the same media files" that can be moved and renamed without affecting the
original ([Film Composer guide][a1], [Avid subclips][a5]). Clip colour is bin
metadata that shows in the timeline (*Clip Color → Source*); a feature
palette in use is VFX tan, titles grey, dialogue pink, ADR dark pink, SFX
mint, music brown, so a timeline can be split by colour at turnover
([Frame.io colour coding][a16]).

**Structure and naming.** Avid's documented *Film Scene Workflow*: "Create
one bin for each scene … gather clips according to scene … sort, sift, and
organize the clips within each scene bin", and "It is best to copy or
duplicate clips as you reorganize them in bins, so that all the original
source clips will remain in the appropriate dailies bin" ([Film Composer
guide][a1]). That gives the two tiers: immutable *dailies* bins by shoot day
or camera roll, and *scene* bins of working copies; modern practice adds event
bins per day or location, scene-number prefixes (`101A_Stringout`,
`101A_Selects`), numeric prefixes to force order (`0 FIN 1 WRK 2 IN 3 GFX 4
MX 5 SFX 9 OLD`), a *Master Bins* folder of read-only copies, favourite bins
pinned in the sidebar, and a warning that nesting beyond three levels slows
navigation ([Block Reel][a29], [Avid Community][a34], [What's New
2019.6][a4]). A film-school template names the bins: transcoded day folders,
linked and transcoded production audio, a *Synching Bin*, scene bins and a
*Dailies Stringout* bin, with subclips renamed from the slate ([FSU][a24]).

[a1]: https://resources.avid.com/SupportFiles/attach/Fcguide.pdf
[a2]: https://resources.avid.com/SupportFiles/attach/Mcguide.pdf
[a3]: https://resources.avid.com/SupportFiles/attach/GettingStartedScriptSync_v6.pdf
[a4]: https://resources.avid.com/SupportFiles/attach/WhatsNew_MediaComposer_v19.6.pdf
[a5]: https://help.avid.com/mediacentral/mediacentralcloudux/MCCUX_Help/NUX_UG_Media.06.27.html
[a6]: https://help.avid.com/MediaCentral/MediaCentralCloudUX/MCCUX_Help/NUX_UG_Browse.04.21.html
[a9]: https://workflow.frame.io/guide/bin-locking-simultaneous-access
[a10]: https://elements.tv/blog/bin-locking-overview-and-troubleshooting-in-avid-media-composer/
[a11]: https://help.frameone.com/support/solutions/articles/69000607018-Avid-Project-Sharing-Basics
[a12]: https://www.provideocoalition.com/media-composer-in-depth-bin-columns/
[a13]: https://elements.tv/blog/avid-media-composer-2022-x-documentation-editing-guide-with-chapter-links/
[a14]: https://www.premiumbeat.com/blog/part-1-making-metadata-work-for-you%E2%80%94creating-custom-columns-in-avid-media-composer/
[a15]: https://www.premiumbeat.com/blog/part-2-making-metadata-work-for-you%E2%80%94performing-sorts-and-sifts-in-avid-media-composer/
[a16]: https://blog.frame.io/2023/04/26/insider-tips-media-composer-color-coding/
[a17]: https://blog.frame.io/2024/01/03/organize-your-avid-media-composer-project-by-story-beats/
[a18]: https://blog.frame.io/2024/07/31/insider-tips-batch-rename-avid-media-composer/
[a19]: https://blog.frame.io/2023/10/18/insider-tips-create-effects-preset-bins-avid-media-composer/
[a20]: https://www.premiumbeat.com/blog/video-tutorial-how-to-use-the-new-find-tool-in-avid-media-composer/
[a21]: https://www.provideocoalition.com/mc-7-is-out-what-avid-wont-tell-you-about-spanned-markers1/
[a22]: https://flylib.com/books/en/1.417.1.17/1/
[a23]: https://blog.alex4d.com/avid-for-final-cut-pro-users/
[a24]: https://fsufilmhandbook.com/assistant-editing-workflow/
[a25]: https://digitalfilms.wordpress.com/2020/12/31/avids-hidden-gems/
[a26]: https://blog.celtx.com/how-to-line-a-film-script/
[a27]: https://copra.zendesk.com/hc/en-us/articles/360003171351-Avid-Media-Composer-exporting-metadata-to-COPRA
[a28]: https://blog.frame.io/2017/10/02/speeding-up-stringouts-keyboard-maestro/
[a29]: https://blockreeldao.com/blog/editorial-organization-bins-stringouts-selects-and-assistant-standards
[a30]: https://pomfort.com/article/ale-avid-log-exchange-files-what-they-are-and-why-you-should-understand-them/
[a31]: https://github.com/dtatut/amf-implementation/blob/master/documentation/ALE.md
[a32]: https://kb.pomfort.com/silverstack/hands-on/creating-dailies/transferring-metadata-to-avid-media-composer/
[a33]: https://creativecow.net/forums/thread/ales/
[a34]: https://community.avid.com/forums/p/100644/579657.aspx

---

## 2. How Premiere Pro organises bins

**The bin is a folder in the Project panel, and nothing on disk.** Adobe's
definition: a bin organises project content in folders "similar to how you
would organise them on your computer"; bins hold source clips, sequences and
other bins, nested to any depth ([bins overview][p1]). One `.prproj` holds
every bin, clip and sequence and only *references* the media, unlike Avid where
every bin is its own `.avb` file ([avb vs prproj][p53]). A bin opens as a tab,
in place, or floating (double-click, Ctrl/Cmd-double-click,
Alt/Opt-double-click; remappable in Preferences → General → Bins)
([change bin behaviours][p4]).

**Three views of a bin.** *List View* (columns), *Icon View* (thumbnails with
hover-scrub: cursor left-to-right maps Media Start to Media End, no audio,
`Shift+H` toggles; `I`/`O` mark while scrubbing; `Shift+P` sets the poster
frame; a zoom slider sizes tiles; sort by User Order, List View Sort or a
metadata field) and *Freeform View* (an unconstrained canvas for storyboarding
with saveable layouts) ([Icon View][p10], [Freeform View][p11]). Icon View is
explicitly the storyboarding surface: arrange, then *Automate To Sequence*
([Icon View][p10]).

**List View columns.** Adobe's live column reference defines: Name, Label,
Media Duration, Video Duration, Audio Duration, Video Info (frame size, aspect,
alpha), Video Usage and Audio Usage (how many times the clip is used in
sequences), Tape Name, Description, Comment, Log Note, Media File Path, Status,
Offline Properties, Scene, Shot and Good ("a marker indicates the preferred
assets") ([List View columns][p8]). Media Type and Frame Rate are also columns
([Project panel][p7], [search bins][p43]). The derived ones (durations, Video
Info, Usage, Media File Path, Status) are read-only; the *logging* fields, Tape
Name, Description, Comment, Log Note, Scene, Shot and Good, are typed by the
user, and Adobe's own note on Scene is "it can be helpful to use scene names
from a script here to organize your work" ([List View columns][p8]). Take,
Client, Codec and Proxy columns exist in the application and in older
editions of the guide but are not in the current reference, so they are cited
here as present-but-unverified. Any XMP field can be shown as a column via
*Metadata Display*, and custom columns are added with *Add Property* as
Integer, Real, Text or Boolean ([List View customisation][p9]).

**Clip metadata is separate from file metadata, and that split is the
important idea.** File metadata (XMP) lives in the source file and is shared by
every clip that references it; clip metadata lives only in the project and is
per item, which "lets you create multiple subclips from a single source, each
with distinct scene descriptions, log notes, or custom labels"
([metadata in Premiere][p16]). Clip fields can be linked to XMP fields, but
Adobe advises against linking when several clip instances share one file
([link clip data][p20]). Multi-selecting clips and typing in the Metadata panel
applies the value to all of them ([edit XMP][p17], [batch logging][p51]).

**Labels.** Up to sixteen label colours, with defaults per media type, chosen
in Preferences → Labels; presets ship (*Default*, *Classic*, *Vibrant* and an
*Editorial* preset "created by TV and film editors") and can be shared as
files ([labels preferences][p21], [Peachpit][p42]). *Label → Select Label
Group* selects everything sharing a colour; editors use colours for batches
of work (stabilise these, replace this unlicensed B-roll, this actor's
coverage) ([ProVideo Coalition][p50]).

**Search and Search Bins.** The Project panel search box filters by name and
searchable metadata; the Find dialog searches precisely ([search][p14],
[Find][p15]). A *Search Bin* is a saved query that updates itself: "if you add
new clips to a project that meet the search criteria, they'll appear in the
Search bin automatically", it holds references rather than copies, supports
And/Or, and can be scoped to one field ([Peachpit][p42], [Larry Jordan][p45]).
The canonical queries are `Good = True` (a self-maintaining selects bin),
`Status = Offline` and `Media Type = Sequence`, and scoping to the Scene field
rather than free text ([Greenberg][p44]). Search Bins can be imported into
other projects or baked into a project template so incoming media files
itself ([Frame.io][p43]).

**Ingest.** The *Media Browser* browses drives and cards, hover-scrubs
thumbnails, opens a clip in the Source Monitor before committing, and imports
structured camera media (P2, XDCAM, RED folders) correctly ([Media
Browser][p40], [file-based media][p25]). *Ingest Settings* (File → Project
Settings) run one of four operations on import, in the background: *Copy*,
*Transcode*, *Create Proxies*, *Copy and Create Proxies*, each with a
destination and a preset; the copy is verified "to ensure that there is no
data corruption or loss" ([ingest settings][p23], [ingest and proxy][p22]).
Proxies can be made later (Proxy → Create Proxies; default half size, ProRes
Proxy, optional watermark; files get a `_Proxy` suffix in a `Proxies` folder)
and toggled in the monitor ([create proxies][p24]). Tape Name is a logging
field "as entered when the clip was logged or captured", not derived from the
card ([List View columns][p8]).

**Subclips, merged clips, multicam.** *Clip → Make Subclip* from In/Out in the
Source Monitor; boundaries stay editable (*Edit Subclip*) except inside an
instance already cut into a sequence ([make subclip][p27], [edit
subclip][p28]). *Merge Clips* joins one video clip with separate audio by In,
Out, timecode or marker ([merge clips][p29]); Frame.io's assistant-editor
guide calls merged clips destructive of audio metadata and prefers *Multi-
Camera Source Sequences*, which synchronise takes by In/Out, timecode, audio or
marker, name cameras from the Camera Angle / Camera Label fields, and move
successfully synced sources into a *Processed Clips* bin, leaving failures
outside it, so sync failure is visible as bin membership ([multicam][p30],
[Frame.io syncing][p46]). *Modify → Interpret Footage* overrides frame rate,
pixel aspect and alpha per clip without touching the file
([Interpret Footage][p31]).

**Markers.** Clip markers set in the Source Monitor travel with the clip into
the timeline; they carry a comment, a duration and a colour, and the Markers
panel lists them at source timecode ([markers overview][p32], [add a
marker][p33]). Stringouts get coloured markers for Action, Cut and Reset
([Frame.io syncing][p46]).

**Good takes and selects.** The *Good* checkbox is the built-in selects flag;
the standard pattern is Good plus a Search Bin on `Good = True`, and scene/
shot/take fields sorted and grouped ([List View columns][p8],
[Greenberg][p44]). Scripted drama keeps a per-scene stringout sequence in
that scene's bin: multicam clips first, then room tone, wild lines, MOS shots
and VFX plates ([Frame.io syncing][p46]).

**Structure and naming.** Bins sort alphabetically, so editors number them
(`01 - Video`, `02 - Audio`) to fix the order and leave gaps
([Vassar][p47], [CourseHorse][p52]). Adobe's minimum is bins for audio,
footage and graphics with nested bins for B-roll, SFX, music "or specific
takes of shots" ([organising assets][p41]). A narrative template: *Syncs,
Scenes, Master Clips, Sequences, SFX, Music* ([Vassar][p47]); an assistant
editor's dailies structure: one dated project per shoot day, a *Processed
Clips* bin, one bin per scene, and a *PROBLEMATIC* bin for false takes and
mismatched footage ([Frame.io syncing][p46]). Renaming an item in the Project
panel never renames the file ([PremiumBeat][p48]). House structure is delivered
as a project template with the bins pre-made ([PremiumBeat][p48]).

**Productions.** For features, a *Production* is a folder of `.prproj` files
that behave like Avid bins: each project is lockable, clips are referenced
rather than duplicated across projects, markers sync between projects but label
colours do not ([about Productions][p37], [clips in a Production][p38],
[Studio Network Solutions][p49]).

[p1]: https://helpx.adobe.com/premiere/desktop/organize-media/file-organization/bins-overview.html
[p4]: https://helpx.adobe.com/premiere/desktop/organize-media/file-organization/change-bin-behaviors.html
[p7]: https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customization-options-for-the-project-panel.html
[p8]: https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/list-view-columns.html
[p9]: https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-list-view-in-project-panel.html
[p10]: https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-icon-view-in-project-panel.html
[p11]: https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/customize-freeform-view-in-project-panel.html
[p14]: https://helpx.adobe.com/premiere/desktop/organize-media/file-organization/search-options-in-premiere.html
[p15]: https://helpx.adobe.com/premiere/desktop/organize-media/file-organization/find-assets-using-the-find-dialog.html
[p16]: https://helpx.adobe.com/premiere/desktop/organize-media/edit-metadata/metadata-in-premiere.html
[p17]: https://helpx.adobe.com/premiere/desktop/organize-media/edit-metadata/edit-xmp-metadata.html
[p20]: https://helpx.adobe.com/premiere/desktop/organize-media/edit-metadata/link-clip-data-to-xmp-metadata.html
[p21]: https://helpx.adobe.com/premiere/desktop/get-started/preferences-and-settings/labels-preferences.html
[p22]: https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/ingest-and-proxy-workflow.html
[p23]: https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/configure-ingest-settings.html
[p24]: https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/create-proxies.html
[p25]: https://helpx.adobe.com/premiere/desktop/organize-media/transfer-files/transfer-assets-from-file-based-media.html
[p27]: https://helpx.adobe.com/premiere/desktop/edit-projects/intro-to-editing/create-a-subclip-from-the-project-panel.html
[p28]: https://helpx.adobe.com/premiere/desktop/edit-projects/intro-to-editing/adjust-media-start-and-end-times-of-subclip.html
[p29]: https://helpx.adobe.com/premiere/desktop/add-audio-effects/basic-audio-editing/merge-clips-in-the-project-panel.html
[p30]: https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html
[p31]: https://helpx.adobe.com/premiere/desktop/edit-projects/modify-clip-properties/modifying-clip-properties-with-interpret-footage.html
[p32]: https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/overview-of-markers.html
[p33]: https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/add-a-marker-to-a-clip.html
[p37]: https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-productions/about-productions.html
[p38]: https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-productions/how-clips-markers-and-labels-work-in-a-production.html
[p40]: https://helpx.adobe.com/ph_fil/premiere-pro/how-to/import-files-with-media-browser.html
[p41]: https://helpx.adobe.com/premiere-pro/using/organizing-assets-project-panel.html
[p42]: https://www.peachpit.com/articles/article.aspx?p=3004578&seqNum=3
[p43]: https://blog.frame.io/2024/04/24/insider-tips-use-search-bins-to-stay-organized-in-premiere-pro/
[p44]: https://www.provideocoalition.com/searching-smarter-in-premiere-pro-with-the-power-of-search-bins/
[p45]: https://dev.larryjordan.com/articles/premiere-pro-cc-create-and-use-search-bins/
[p46]: https://blog.frame.io/2023/04/10/editors-guide-syncing-premiere-pro-projects/
[p47]: https://pages.vassar.edu/film-majors/premiere-pro-project-organization/
[p48]: https://www.premiumbeat.com/blog/organization-in-premiere-pro/
[p49]: https://www.studionetworksolutions.com/adobe-productions-shared-projects-in-premiere-pro/
[p50]: https://www.provideocoalition.com/tool-tip-tuesday-for-adobe-premiere-pro-mass-select-timeline-labels/
[p51]: https://www.nobledesktop.com/learn/premiere-pro/the-importance-of-metadata-display-in-organizing-adobe-premiere-pro-projects
[p52]: https://coursehorse.com/blog/learn/premiere-pro/using-project-panels-to-stay-organized-in-premiere-pro
[p53]: https://conversionai.com/file/video/avb-avid-bin-file-format/prproj-premiere-pro-project

---

## 3. Working practice shared by both

**Bins per shoot day, per scene, per media type.** Frame.io's workflow guide
gives the tool-agnostic top level as *Sequences, Audio, Footage, Graphics,
Misc*, numbered `00_`, `10_`, `20_`, `30_`, `40_` purely to force the NLE's
alphabetical sort, with shoot days separated as "Day 1 Audio", "Day 2 Audio"
and the stated purpose that "any editor stepping into the project should
locate any element without searching" ([Frame.io bin organisation][s1]). An
assistant-editor template built for Avid has day bins of transcoded master
clips, a *Syncing Bin* where a day's audio and video sit together for
AutoSync, one bin per scene laid out as a grid (rows are setups, columns are
takes), and a dailies stringout bin ([FSU film handbook][s8]). Broadcast and
corporate work uses media-type folders (Audio, Stills, Lower Thirds, Logos,
Slates and so on) ([Larry Jordan][s24]). The reusable form is a template
project with the bins pre-made ([PremiumBeat][s23]).

**Selects and stringouts.** A *stringout* (also assembly or KEM roll, from the
flatbed era) is a sequence of every shot for a scene in order, slates trimmed;
variants are the dialogue or "line" stringout (every angle of every take of one
line), the VFX stringout and the *alt* stringout of backup takes
([Frame.io stringouts][s2], [MASV post chain][s32]). Selects live in different
shapes depending on the editor: subclips in a selects bin, marker ranges on a
single per-scene stringout timeline (one feature editor keeps no selects bins
at all and colours markers by *whose* opinion they carry: green editor, red
director, white producer, orange continuity), a checkbox column, or an
`X` / `XX` custom column ([Frame.io stringout speed][s5], [Oliver Peters][s11]).
"Pulling selects" is the name of the pass ([MASV][s32]).

**Naming: scene, setup, take.** The slate grammar is scene number plus a setup
letter: the first setup of scene 24 is `24`, and every camera move or lens
change adds a letter (`24A`, `24B`, then `24AA`); take numbers belong to the
*setup* and reset to 1 when the letter changes ([The Black and Blue,
slate 1][s12], [ProVideo Coalition slating][s14]). Modifiers: `P/U` for a
pickup that starts mid-scene, `SER` for a series of mini-takes under one
slate, `MOS` for no sound, `Plate` for VFX plates, `TONE` for room tone
([slate 2][s13]). One editor's bin vocabulary: `48` master, `48A` / `48B`
coverage, `48A-cu`, `48-PU`, `A48` alternate, `48F-Ser` ([Oliver
Peters][s11]). Rolls and cards are camera letter plus three digits (`A001` is
A-camera's first card), and cameras write clip names from them: ARRI
`A001C001_<stamp>.mxf`, RED `A001_C001_<stamp>.R3D`, Sony consumer bodies a
bare `C0001` with no reel prefix, which is why cards need unique identifiers
and dated reel folders rather than renames ([Clapper naming][s18],
[Frame.io pitfalls][s4]). Shoot days are named in ISO dates so the filesystem
sorts chronologically ([Frame.io pitfalls][s4]). The NLE does not parse these
from filenames: it reads an *ALE* (Avid Log Exchange) with Name, Tape, Scene,
Take, Soundroll, Camera, timecodes, notes and a circle-take column, and
Media Composer builds a clip name from Scene and Take when Name is blank
([Pomfort ALE][s28], [Webgate][s-web]).

**Metadata entered at ingest.** Technical metadata (frame rate, resolution,
codec, lens, camera serials) arrives embedded or in sidecars; *content*
metadata (description, scene, keywords) is typed by a person and lives in the
project, not the media, which is why it is entered as the media lands or not
at all ([Frame.io metadata][s3], [Larry Jordan][s24]). What the assistant
types per clip: scene, shot, take, camera, roll, sound roll, day, shot size,
remarks, good or no-good transcribed from the camera and sound reports, with
NG takes coloured red in the bin ([FSU][s8], [Jonny Elwyn codebook][s10],
[Greenberg metadata panel][s26]).

**Never rename source media on disk.** Renaming native camera files detaches
RAW sidecars and breaks batch operations; the alternative is a shot log that
maps native names to scene and take ([Clapper naming][s18], [Larry
Jordan][s24]). Relink matches proxies to originals by identical clip name and
timecode, so a rename on either side breaks the conform ([Frame.io proxy
guide][s7]). Editors do rename *clips* inside the NLE to something readable
("Sc 1 Tk 1") while keeping the camera name in another column ([Jonny Elwyn
2nd AE][s9], [FSU][s8]); the rule is really "never lose the original
identifier or the folder structure".

**Checksum-verified offloads.** The offload tool hashes the card, copies, and
re-hashes the copy (xxHash for speed, MD5 where a post house mandates it),
writes an ASC *MHL* manifest recording every file's checksum and every move,
and the card is not reused until the 3-2-1 copies exist ([Hedge
verification][s30], [Pomfort verification][s29], [Frame.io MHL][s6],
[MASV 3-2-1][s31]). The chain is camera card → DIT offload → dailies and
proxies → editorial ([MASV][s32]).

**Proxies versus originals.** Editorial cuts on intraframe proxies (ProRes
Proxy, DNxHR LB) that carry the original's clip name and timecode, with clip
name, source timecode, date and card burnt in; the timeline is conformed back
to originals after picture lock ([Frame.io pitfalls][s4], [Frame.io proxy
guide][s7]).

**Master clip versus subclip.** A subclip is a portion of a master clip
isolated so notes can be attached to that portion; assistants build mix-only
and MOS subclips and populate scene bins with subclips rather than masters
([FSU][s8]). Selects can equally be a sequence ([FSU][s8],
[Frame.io stringouts][s2]).

**Script supervisor notes and circled takes.** The lined script carries
vertical lines per setup showing which dialogue each setup covered (straight
where the face is visible, squiggly where not); the facing pages carry
setups, take counts, roll or file per take, runtimes and the *circled* takes,
which are the director's preferred takes, a preference rather than a verdict
(editors still watch take 1, and directors circle flawed takes worth fixing)
([EditStock lined script][s15], [EditMentor][s16], [Clapper circle
takes][s17]). Circling began as the lab's print list, recorded twice (script
supervisor and camera report), and today reaches Avid through the ALE's
circle-take column and Premiere through *Good* ([Clapper][s17],
[Simmons, the Good column][s25]). Set shorthand the editor decodes: NG (no
good), FS (false start), wild track (sound without picture)
([Clapper][s17]). ScriptSync links every master clip to the script line it
covers so every performance of a line plays back to back ([PremiumBeat
ScriptSync][s21]).

**One shot in the cut from several takes.** The enabling technique is the
split edit: picture from one take, sound from another, so a better reading
survives a picture cut (L-cut and J-cut) ([split edit][s20], [Oliver
Peters][s11]); a cutaway or a camera move hides the join. Synchronised takes
are grouped as multicam group clips (by timecode, slate frame or waveform) and
cut as one object ([PremiumBeat multicam][s22]). Vocabulary: the *circle* or
*hero* take is the preferred performance; *alt* is the standing prefix for
alternates ([Oliver Peters][s11], [Frame.io stringouts][s2]).

**Review vocabulary.** Final Cut Pro is the most formal: *Favorite*,
*Rejected*, *Unrated* on a clip or a range, with a Hide Rejected filter
([Apple][s27]); Premiere has *Good* and *Hidden* ([Greenberg][s26]); Avid
practice is bin colour plus custom columns ([FSU][s8], [Oliver Peters][s11]).
"Keeper" and "hold" have no standard definition. Two review playlists per day
(selects and all-takes) were the studio deliverable on one feature ([Jonny
Elwyn codebook][s10]).

**Take, setup, shot.** A take is one recorded attempt of a setup; a setup
changes with camera position, lens or an action change; the shot list plans
one setup per row and the slate letters are what those rows become on the day
([Wikipedia take][s19], [slate 1][s12], [StudioBinder][s-sb]). Take numbers
are unique only within a setup, so a flat take counter per scene collides.

[s1]: https://workflow.frame.io/guide/bin-organization
[s2]: https://workflow.frame.io/guide/stringouts
[s3]: https://workflow.frame.io/guide/metadata
[s4]: https://blog.frame.io/2018/12/10/offline-online-workflow-pitfalls/
[s5]: https://blog.frame.io/2017/10/02/speeding-up-stringouts-keyboard-maestro/
[s6]: https://blog.frame.io/2022/08/22/mhl-media-hash-lists-workflow/
[s7]: https://help.frame.io/en/articles/6079079-c2c-complete-proxy-workflow-guide
[s8]: https://fsufilmhandbook.com/assistant-editing-workflow/
[s9]: https://jonnyelwyn.co.uk/film-and-video-editing/how-to-be-a-2nd-assistant-film-editor/
[s10]: https://jonnyelwyn.co.uk/film-and-video-editing/inside-an-assistant-film-editors-codebook/
[s11]: https://digitalfilms.wordpress.com/2021/12/12/building-a-scene/
[s12]: https://www.theblackandblue.com/2012/11/05/deciphering-film-slate-1/
[s13]: https://www.theblackandblue.com/2012/11/09/deciphering-film-slate-2/
[s14]: https://www.provideocoalition.com/the-secret-art-of-the-slate-25-tips-to-help-you-slate-like-a-pro/
[s15]: https://editstock.com/blogs/all/how-to-read-a-lined-script
[s16]: https://help.editmentor.com/en/articles/5422544-lined-script-and-facing-pages
[s17]: https://clapper.in/articles/circle-takes-explained/
[s18]: https://clapper.in/articles/camera-clip-naming-conventions/
[s19]: https://en.wikipedia.org/wiki/Take
[s20]: https://en.wikipedia.org/wiki/Split_edit
[s21]: https://www.premiumbeat.com/blog/part-1-setting-up-your-script-for-scriptsync-in-avid-media-composer/
[s22]: https://www.premiumbeat.com/blog/setting-up-for-multi-camera-editing-in-avid-media-composer-part-1-of-2/
[s23]: https://www.premiumbeat.com/blog/organization-in-premiere-pro/
[s24]: https://larryjordan.com/articles/getting-organized-for-editing/
[s25]: https://www.provideocoalition.com/tool-tip-tuesday-for-adobe-premiere-pro-the-good-column/
[s26]: https://www.provideocoalition.com/you-should-be-using-the-metadata-panel/
[s27]: https://support.apple.com/guide/final-cut-pro/rate-clips-ver30ccd91f/mac
[s28]: https://pomfort.com/article/ale-avid-log-exchange-files-what-they-are-and-why-you-should-understand-them/
[s29]: https://pomfort.com/article/backup-shooting-data-verification-behavior/
[s30]: https://docs.hedge.video/offshoot/features/verification
[s31]: https://masv.io/blog/3-2-1-backup-rule
[s32]: https://masv.io/workflow/post-production
[s-web]: https://webgate.io/en/features/metadata
[s-sb]: https://www.studiobinder.com/blog/shot-list-vs-storyboard/

---

## 4. What this means for R.A.B.B.I.T.

Everything below is mapped onto what already exists (measured 2026-09-10 on
`origin/feat/demo-2026-09-11` at `81bb2e9`): `public.scenes` and
`public.shots` from migration 0040 with their local-bundle twins, the managed
files subsystem (`bundle.managedFiles`, the `managed-files` routes in
`electron/main.cjs` with `stream` and `thumbnail`, `electron/ffmpeg.cjs`,
`sharp`), the provider's `optimistic` / `pushHistory` / `showUndoToast`
pattern, and the `supportsManagedFiles` capability flag. Where Audrey's brief
and the research pull in different directions the brief wins, and the
question is listed in §5.

### 4.1 Adopted

| Practice | Source | What R.A.B.B.I.T. does |
|---|---|---|
| A bin is a container inside the project, not a folder on disk | Premiere §2 (bins live only in the `.prproj`); Avid §1 (bins are `.avb` files separate from media) | `bins` rows in the project. Bin membership is metadata on the bin file; moving a file between bins never moves bytes. |
| Editors order bins by hand and fake it with numeric prefixes | §2 (`01 - Video`), §3 (`00_Sequences … 40_Misc`) | Bins are a hand-ordered list (`sort_order`, drag to reorder). No prefixes needed. |
| Bins are organised per shoot day, per scene and per media type, and a template pre-makes them | §3 (Frame.io, FSU, PremiumBeat) | A `kind` on each bin (footage, audio, stills, graphics, vfx, selects, other) and a "starter set" the empty state offers: one bin per media type, or one per existing scene, or one per shoot day (§5 Q6). |
| The clip's name is separate from the file's name; clips are renamed, files never are | §2 (Name renames the project item, not the file); §3 (rename clips to "Sc 1 Tk 1", keep the camera name in a column; never rename camera files) | `display_name` is Audrey's "name of the shot/still/etc."; `original_name` and the on-disk name are kept verbatim from the camera. The bins routes copy files under their **original filename** (the general managed-file POST renames to `Project_File_v001`, which would destroy `A001C003…` names, so bins use their own create route). |
| Clip metadata is per instance, so one source can appear twice with different logging | §2 (file vs clip metadata) | "Copy to bin" creates a second `bin_files` row pointing at the **same** `managed_file_id`. No bytes are duplicated; each instance has its own name, flag and notes. |
| Logging fields are typed at ingest: scene, shot, take, camera, roll, day, description, notes, good | Avid §1 (Scene, Take, Camroll, Soundroll, Comments); Premiere §2 (Scene, Shot, Take, Log Note, Description, Good); §3 (what the assistant types) | Those exact fields on `bin_files`, editable inline and in bulk, entered on the add dialog before the copy starts. |
| Take numbers belong to the setup, not the scene; slates carry modifiers (PU, SER, MOS, plate) | §3 | `slate` (free text, e.g. `24A`), `take_number`, `take_modifier`. The scene and shot links are separate from the slate text because a slate can name a setup that has no shot row yet. |
| The technical columns are derived, not typed: duration, start timecode, frame size, fps, codec, file size | Avid §1 (Duration, Start, Video, FPS); Premiere §2 (Media Duration, Video Info, Frame Rate) | Probed once at add: `ffmpeg -i` already runs for `Duration:` (`probeDurationSec`); the same stderr carries `Stream … Video: h264 …, 1920x1080, 23.98 fps` and `timecode :`, so width, height, fps, codec and start timecode cost nothing extra. `sharp` gives stills their size. Without ffmpeg the renderer reads duration and size from a hidden `<video>` for browser-playable files, exactly as the thumbnail fallback does today. |
| A poster frame per clip; a frame view and a list view | Avid §1 (Frame / Text views); Premiere §2 (Icon / List views) | The existing `managed-files/:id/thumbnail` route (ffmpeg poster, renderer fallback, `sharp` for stills). Grid and table views of a bin, with the same sort and filters. |
| Review is a three-state flag, plus a self-maintaining selects view | FCP Favorite / Rejected / Unrated; Premiere Good + Search Bin `Good = True`; Avid red bin colour for NG | `review_flag` in `select`, `reject`, `unflagged`, with keys `S`, `R`, `U`; a "Selects" filter across a bin or the whole project rather than a physical selects bin (Premiere's search-bin idea: references, not copies). Optional colour label and rating per §5 Q8. |
| Sift and sort on every column; search | Avid §1 (Custom Sift, multi-column sort); Premiere §2 (search box, Find, Metadata Sort) | Filter chips for media type, review flag, scene, shot, camera, day; free-text search over name, slate, notes, original name; sortable columns. |
| Ingest copies verified from the card into project storage; bins per day; duplicates and failures are visible | Premiere §2 (Ingest: Copy, verified); §3 (DIT chain, Processed Clips vs PROBLEMATIC) | Add from an OS file dialog, an OS folder dialog (walk the folder, one row per file, a per-file result line) or drag-and-drop; the copy streams through the existing `rabbit:copy-file` IPC with progress; a file whose copy fails is reported, not half-added; duplicates (same source path already in the project, or same name and size) are reported and skipped unless she says otherwise. |
| A file whose media is missing is "offline" and says so | Premiere §2 (Status, Offline Properties) | The list route stats each body once and returns `online: false` for a missing file; the row shows it and the preview says "file missing on disk" (the stream route already answers 410). |
| Multiple takes build one shot; the cut names a primary and alternates | §3 (split edits, multicam groups, circle/hero take, alt takes) | Milestone 2: `shot_takes` with a `role` of `primary`, `part` or `alt` and an order, many-to-many (§5 Q9). |

### 4.2 Simplified or left out, and why

- **No nesting for Friday.** Both tools nest, and both communities flatten
  with numeric prefixes anyway (§2, §3). A hand-ordered flat list gives the
  ordering without a tree UI. `parent_bin_id` stays in the model, nullable and
  unused, so nesting is a UI change later, not a migration.
- **No subclips, markers, script integration or multicam grouping.** Those
  are editing-time tools (§1 locators and ScriptSync, §2 markers and
  multicam). Audrey's spec is review and organisation before the edit, and
  "this is all this feature should have".
- **No proxies or transcodes.** The desktop plays what Chromium plays
  (H.264 / AAC MP4, WebM) through the Range-capable stream route; a
  professional codec gets its poster frame and an honest "preview not
  available for this format", the state the existing `VideoPreview` already
  names. Per §5 Q10.
- **No ALE import, no filename parsing by default.** The NLEs do not parse
  filenames either; they read the ALE (§3). A conservative parser for the
  common `Scene_Shot_Take_Camera` shapes is offered as a suggestion on the
  add dialog, never applied silently (§5 Q7).
- **Bins are not the deliverables file manager.** `Assets` keeps versions,
  `v001` naming and the `ASSETS/` mirror. Bin files copy to
  `BINS/<Bin-Slug>/` under the project root with their original names and
  are never versioned.
- **Bytes stay where they were ingested.** Moving a bin file to another bin
  changes `bin_id` only. Renaming or moving camera media breaks relinks and
  sidecars (§3), and two bin files may share one managed file, so the disk
  path is set once at ingest. "Open in Explorer" reveals the real file.

### 4.3 Media types and what a card shows

| `media_type` | Extensions (from the existing `VIDEO_EXTENSIONS` / `THUMB_EXTENSIONS` sets plus audio) | Card |
|---|---|---|
| `video` | .mp4 .mov .m4v .webm .mkv .avi .mxf .mts .m2ts .r3d .ari .braw .dnx… | poster frame, duration, WxH, fps, codec, slate / take, camera, flag |
| `still` | .jpg .jpeg .png .gif .webp .tiff .tif .bmp .avif .heic | thumbnail, WxH, flag |
| `audio` | .wav .aif .aiff .mp3 .flac .m4a .ogg | waveform icon, duration, roll, flag; inline `<audio>` |
| `graphic` | .psd .ai .svg .eps .pdf(design) | type icon, WxH when readable, flag |
| `vfx` | .exr .dpx (single or sequence folder), .mov renders | poster when decodable, else icon; frame count for sequences |
| `document` | .pdf .txt .docx .xlsx .csv (sides, camera reports, sound reports) | type icon, size |
| `other` | anything else | type icon, size |

`media_type` is guessed from the extension at add time and editable.

### 4.4 Data model

Local: `bundle.bins`, `bundle.binFiles`, `bundle.shotTakes` (arrays in the
project bundle, migrated in on read like `scenes` and `shots`). Cloud, if
built: migration **0079**, pgTAP suite **75**, RLS as scenes/shots, entries in
`COLUMN_ALLOWLIST` and `RLS_TABLES`.

**`bins`** — `id`, `project_id`, `workspace_id` (null locally), `name`,
`description`, `kind` (`footage | audio | stills | graphics | vfx | selects |
other`), `color` (label colour or null, §5 Q8), `parent_bin_id` (null, reserved),
`sort_order`, `created_at`, `created_by`, `updated_at`, `updated_by`.
Justified by §4.1 rows 1–3 and 8.

**`bin_files`** — `id`, `project_id`, `bin_id`, `managed_file_id` (the bytes:
path, size, mime, thumbnail cache), `display_name`, `media_type` (§4.3),
`scene_id` (nullable), `shot_id` (nullable; the take's *intended* setup,
distinct from milestone 2's assignment), `slate`, `take_number`,
`take_modifier`, `camera`, `roll`, `shoot_day` (date), `description`,
`notes`, `review_flag` (`unflagged | select | reject`), `rating` (null or 1–5,
§5 Q8), `color` (§5 Q8), `duration_sec`, `width`, `height`, `fps`, `codec`,
`timecode_start`, `frame_count` (image sequences and, derived, video),
`sort_order`, `added_by`, `added_at`, `updated_at`. `size_bytes`,
`original_name`, `extension` and `mime_type` live on the managed file and are
joined for display. `online` is computed by the list route, not stored.
Justified by §4.1 rows 4–7, 9 and 11.

**`shot_takes`** (milestone 2) — `id`, `project_id`, `shot_id`,
`bin_file_id`, `role` (`primary | part | alt`), `position`, `notes`,
`created_at`, `updated_at`; unique on (`shot_id`, `bin_file_id`). Justified by
§4.1 row 12.

### 4.5 Where the bytes go and how they get there

1. The user picks files (OS dialog, multi-select), a folder (OS dialog), or
   drops files on a bin. Electron exposes `File.path` on dropped files, so
   all three produce source paths.
2. For each path the renderer asks the new `POST …/bins/:binId/files/prepare`
   route (in `electron/rabbitBins.cjs`) to check duplicates (same source path
   recorded in the project; same `original_name` and `size_bytes`) and to
   guess media type. The add dialog shows the batch: name, type, parsed
   slate suggestion, duplicate warnings, and the logging fields to apply to
   the whole batch (scene, shoot day, camera).
3. On confirm, per file: create the managed-file row through the bins create
   route (original filename preserved, `folder_path = BINS/<Bin-Slug>/`),
   copy through the existing `rabbit:copy-file` IPC with progress, then
   `POST …/bin-files/:id/probe` runs ffmpeg or sharp and fills the technical
   columns and the poster frame (reusing `generateVideoThumbOnce`). A failed
   copy removes the row and reports the file; a failed probe leaves the row
   with the columns blank and the card saying so.
4. The bins list, bin-file list, patch, bulk patch, move, copy, reorder and
   delete routes live in `rabbitBins.cjs`, mounted from `main.cjs` with one
   line and handed the bundle helpers it needs rather than copying them.
   Delete of a bin file that is the last reference to its managed file
   deletes the body from disk (hard) after a confirmation that names the
   count; delete of a bin lists what is inside it first.
5. Everything is behind `ctx.supportsBins`, true only for the Local Server
   adapter in the desktop app, mirroring `supportsManagedFiles`. The cloud
   adapter reports not supported and the tab shows an honest empty state.

---

## 5. Questions for Audrey (asked 2026-09-10, with the recommended answer)

Already answered through the controller session on 2026-09-09: the desktop
Local Server backend comes first (cloud only if time remains), and Friday
2026-09-11 afternoon stands for both milestones.

1. **Copy files into the project's storage on add, or reference them where
   they are?** Recommend **copy**: editors never work from the card (§3), the
   stream and thumbnail routes only serve files under the project root, and
   referencing would need relink work that does not exist. "Open in
   Explorer" still reveals the copy.
2. **Media types accepted.** Recommend video, stills, audio, graphics (PSD /
   AI / SVG / PNG), VFX renders (EXR / DPX / MOV) and documents (sides,
   camera and sound reports), one file = one item. Image *sequences* (a folder
   of numbered frames as one item) are out for Friday.
3. **Bin structure.** Recommend a flat, hand-ordered list of bins, each with a
   kind and a colour, no nesting for Friday (the field is reserved); the
   empty state offers a starter set (one bin per media type, or one per
   existing scene, or one per shoot day), otherwise bins are made by hand;
   folder import can put each subfolder into its own bin.
4. **Logging fields and filename parsing.** Recommend the fields in §4.4:
   display name, slate, take, take modifier, camera, roll / card, shoot day,
   scene and shot links, description, notes. The add dialog suggests slate /
   take / camera parsed from names like `12A_3_T4_A`, `SC12A_SH03_TK04` and
   `A001C003…`, applied only when accepted. Which of these does she fill?
5. **Review vocabulary.** Recommend select / reject / unflagged (keys S, R,
   U) plus an eight-colour label; no star rating (two systems is enough; the
   field stays nullable).
6. **"Shots in a scene that are in an edit."** Recommend every shot whose
   status is not `omitted`, because no assembly object exists yet. Also: one
   take may be assigned to several shots (yes, a reworked shot reuses
   material); the primary take's poster becomes the shot thumbnail only when
   the shot has none of its own; `frame_count` is never overwritten (a take is
   longer than the shot it feeds) but a one-click "use take length" is
   offered; a reworked shot shows its takes in order with roles and a count.
7. **Proxies / transcodes.** Recommend none for Friday: H.264 / AAC MP4 and
   WebM play inline, professional codecs get a poster frame and an honest
   notice. If the demo footage is ProRes or MXF, say so now.
8. **Sample footage and ffmpeg.** What format, count and size will the demo
   show? And does her checkout have `resources/ffmpeg/ffmpeg.exe`? The app
   only looks there (or `WILSON_FFMPEG_PATH`), not on PATH, and without it
   there are no poster frames, durations or frame sizes for anything Chromium
   cannot decode. Recommend copying the winget `ffmpeg.exe` into that folder
   (it is gitignored).
9. **Duplicates.** Recommend report-and-skip by default (same source path
   already in the project, or same name and size), with an "add anyway".
10. **Delete.** Recommend: removing a bin file that is the last reference to
    its bytes deletes the file from disk after a confirmation that says so
    (no undo for bytes); everything else (edits, moves, flags, reorders,
    bin renames) has undo. Deleting a bin with files asks whether to move
    them to another bin or delete them too.
11. **From the research.** Two ideas worth a yes or no: hover-scrub on grid
    tiles for browser-playable video (Premiere's Icon View), and Avid's
    two-tier practice of an untouched "dailies" bin per day plus scene bins
    of copies, which "copy to bin" as an instance already supports.
