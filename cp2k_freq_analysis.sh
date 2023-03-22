#!/usr/bin/env bash

echo "Vibrations to analyze? (ex. : 1 2 3)"

read VIBS

awk '/Atoms/,/FREQ/' $1 | tail -n +2 | head -n -1 > coord_initial.xyz

awk '/CP2K > FORCE_EVAL > QMMM > QM_KIND/,/CP2K > FORCE_EVAL > QMMM > LINK/' $2 | tail -n +2 | head -n -1 | egrep -o '[0-9.]+' > QM_atoms.dat

for i in `cat QM_atoms.dat`; do

    sed -n ''"$i"'p' coord_initial.xyz

done > coord_initial_qm.xyz

for i in `echo $VIBS`; do

    NEXT_VIB=$(( "$i" + 1))

    awk '/vibration'".*"' '"$i"'$/,/vibration'".*"' '"$NEXT_VIB"'$/' $1 | tail -n +2 | head -n -1 > VIB_N_"$i".dat

    for x in `cat QM_atoms.dat`; do

        sed -n ''"$x"'p' VIB_N_"$i".dat

    done > VIB_N_"$i"_qm.dat

    echo $( cat VIB_N_"$i"_qm.dat | wc -l ) > VIB_N_"$i"_COORD.xyz
    echo "i = 1" >> VIB_N_"$i"_COORD.xyz
    cat coord_initial_qm.xyz | awk '{ print $1, $4, $5, $6}' >> VIB_N_"$i"_COORD.xyz
    echo $( cat VIB_N_"$i"_qm.dat | wc -l ) >> VIB_N_"$i"_COORD.xyz
    echo "i = 2" >> VIB_N_"$i"_COORD.xyz

    count=0

    while read -r line; do

        ((count+=1))

        echo -n -e "$(echo "$line" | awk '{ print $1}')" '\t'
        echo -n -e `echo "$(echo "$line" | awk '{ print $4}') + $(sed -n ''"$count"'p' VIB_N_"$i"_qm.dat | awk '{ print $1}')" | bc -l` '\t'
        echo -n -e `echo "$(echo "$line" | awk '{ print $5}') + $(sed -n ''"$count"'p' VIB_N_"$i"_qm.dat | awk '{ print $2}')" | bc -l` '\t'
        echo -e `echo "$(echo "$line" | awk '{ print $6}') + $(sed -n ''"$count"'p' VIB_N_"$i"_qm.dat | awk '{ print $3}')" | bc -l`

    done < coord_initial_qm.xyz >> VIB_N_"$i"_COORD.xyz

    rm coord_initial.xyz coord_initial_qm.xyz QM_atoms.dat VIB_N_"$i".dat VIB_N_"$i"_qm.dat

done
