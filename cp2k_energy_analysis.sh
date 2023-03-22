#!/usr/bin/env bash

echo "Reverse order? (y/n)"
read REVERSE
if [ $REVERSE == y ]; then

    echo -e \| "OUTPUT" '\t'\| "GEOPT CYCLES" '\t'\| "E_T/Hartree" '\t''\t'\| "E_QM+QMMM/Hartree" '\t'\| "E_MM/Hartree" '\t''\t'\| "ΔE_T/kcal.mol-1" '\t'\| "ΔE_QM+QMMM/kcal.mol-1" \| "ΔE_MM/kcal.mol-1" '\t'\|

    declare -a CP2K_ARRAY=($(ls "$@" | sort -r -t _ -nk2 ))

    for (( i = 0; i < ${#CP2K_ARRAY[*]}; ++ i)); do
        echo -n -e "${CP2K_ARRAY[$i]}" '\t' ; echo -n -e " $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | wc -l)" '\t'
        echo -n -e "$(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}')" '\t'
        echo -n -e "$(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')" '\t'
        echo -n `echo "$(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')" | bc -l`
        echo -n -e '\t'
        printf "%3.15f" `echo  "($(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $9}'))*627.5" | bc -l`; echo -n -e '\t'
        printf "%3.15f" `echo "($(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}') - $(grep "Total energy:" "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $3}'))*627.5" | bc -l`; echo -n -e '\t'
        printf "%3.15f\n" `echo "(( $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')) - ( $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $9}')  - $(grep "Total energy:" "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $3}')))*627.5" | bc -l`
    done

elif [ $REVERSE == n ]; then

    echo -e \| "OUTPUT" '\t'\| "GEOPT CYCLES" '\t'\| "E_T/Hartree" '\t''\t'\| "E_QM+QMMM/Hartree" '\t'\| "E_MM/Hartree" '\t''\t'\| "ΔE_T/kcal.mol-1" '\t'\| "ΔE_QM+QMMM/kcal.mol-1" \| "ΔE_MM/kcal.mol-1" '\t'\|

    declare -a CP2K_ARRAY=($(ls "$@" | sort -t _ -nk2 ))

    for (( i = 0; i < ${#CP2K_ARRAY[*]}; ++ i)); do
        echo -n -e "${CP2K_ARRAY[$i]}" '\t' ; echo -n -e " $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | wc -l)" '\t'
        echo -n -e "$(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}')" '\t'
        echo -n -e "$(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')" '\t'
        echo -n `echo "$(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')" | bc -l`
        echo -n -e '\t'
        printf "%3.15f" `echo  "($(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $9}'))*627.5" | bc -l`; echo -n -e '\t'
        printf "%3.15f" `echo "($(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}') - $(grep "Total energy:" "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $3}'))*627.5" | bc -l`; echo -n -e '\t'
        printf "%3.15f\n" `echo "(( $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $9}') - $(grep "Total energy:" "${CP2K_ARRAY[$i]}" | tail -n -1 | awk '{print $3}')) - ( $(grep "Total FORCE_EVAL " "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $9}')  - $(grep "Total energy:" "${CP2K_ARRAY[0]}" | tail -n -1 | awk '{print $3}')))*627.5" | bc -l`
    done

fi
