#!/bin/bash
# Records the README walkthrough: a real Claude + toc session (this repo,
# loaded with --plugin-dir) in a throwaway tmux server, driven by keys, one
# snapshot per frame (name + hold seconds). Then ./build.sh.
M=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$M/../../.." && pwd)   # the repo: demoed on itself
cd $M; rm -f f*.json f*.png durations.txt
T() { tmux -L tocdemo "$@"; }
T kill-server 2>/dev/null; sleep 1.5
T -f $M/tmux.conf new-session -d -s d -x 236 -y 52 "cd $R && claude --plugin-dir $R; sleep 1200"
T set-environment -g COLORTERM truecolor
sleep 15
C=$(T list-panes -t d -F '#{pane_id}' | head -1)
k() { T send-keys -t ${3:-$C} "$1"; sleep ${2:-0.9}; }
shot() { n=$(command ls | grep -c '^f.*\.json$'); f=$(printf 'f%03d' $n); python3 termshot.py snap tocdemo d $f.json; echo "$f $1" >> durations.txt; }
side() { T capture-pane -p -t $C | awk -F'│' 'NF>1{print $NF}'; }
T send-keys -t $C -l "In two short sentences: where are we in DEV_PLAN.md, and what is left before v0.1?"; sleep 0.5
k Enter 50
k C-x 0.15; k t 1.6
side | grep -q "Context" || { echo "no sidebar"; exit 1; }
shot 2.6
for i in 1 2 3 4 5; do k j 0.8; shot 0.8; done
for i in $(seq 1 40); do k j 0.45; [ $((i % 3)) = 0 ] && shot 0.35; side | grep -q "M11 brief" && break; done
shot 2.8
for i in 1 2 3 4 5; do k j 0.6; done; shot 1.8          # S11.5 and its brief
k l 1.3; shot 2.4                                       # l: into its Artifacts
k j 0.5; k j 0.8; shot 1.0                              # past the note, onto the commit
k j 0.6; k j 0.9; shot 1.2                              # a file in it
k l 1.3; shot 2.6                                       # l: Preview at that file
k f 1.0; shot 2.0                                       # f: page
k h 0.8; k k 0.6; k k 0.9; shot 1.0                     # back to the commit
k Enter 3.0; V=$(T list-panes -t d -F '#{pane_id} #{pane_active}' | awk '$2==1{print $1}')
shot 3.0                                                # the whole commit in delta, left of Claude
k n 0.9 $V; k n 1.0 $V; shot 2.2                        # n: next file
k q 1.8 $V; shot 1.2                                    # q: back to toc
k j 0.8; k v 3.5; shot 3.2                              # v: lazygit, that file's history
L=$(T list-panes -t d -F '#{pane_id} #{pane_active}' | awk '$2==1{print $1}'); k q 1.8 $L; shot 1.0
k 5 1.0; shot 2.4; k h 0.9; shot 0.8                    # the Keys legend
k C-x 0.15; k t 1.4; shot 1.2                           # Ctrl+X T: away
k C-x 0.15; k t 1.6; shot 2.6                           # …and back
echo done $(command ls | grep -c json) frames
